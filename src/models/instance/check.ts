import type { Issue, Severity } from '../../ecosystem/registry';
import type { Diagram as EerDiagram, EntityNode } from '../eer/types';
import {
  entities as eerEntities,
  identifyingOwner,
  isaNodes,
  participantsOf,
  relationships as eerRelationships,
  subclassesOf,
  superclassOf,
} from '../eer/graph';
import { functionalSides, isTotal } from '../eer/ddl';
import type { Diagram, DiagramNode, Id } from './types';

type EntitySet = Extract<DiagramNode, { kind: 'entity-set' }>;
type Instance = Extract<DiagramNode, { kind: 'instance' }>;

const norm = (s: string) => s.trim().toLowerCase();

/** Everything about the sample data, indexed the way the checks need it. */
interface Index {
  sets: EntitySet[];
  /** Entity name (normalised) -> the sets standing for it. */
  setsByEntity: Map<string, EntitySet[]>;
  instancesOf: Map<Id, Instance[]>;
  setOf: Map<Id, EntitySet>;
  /** Relationship name (normalised) -> its links. */
  linksByRelationship: Map<string, Link[]>;
  unassignedLinks: Id[];
}

interface Link {
  id: Id;
  a: Instance;
  b: Instance;
  setA: EntitySet | undefined;
  setB: EntitySet | undefined;
}

function index(d: Diagram): Index {
  const sets = d.nodes.filter((n): n is EntitySet => n.kind === 'entity-set');
  const instances = d.nodes.filter((n): n is Instance => n.kind === 'instance');
  const relSetName = new Map<Id, string>(
    d.nodes
      .filter((n): n is Extract<DiagramNode, { kind: 'rel-set' }> => n.kind === 'rel-set')
      .map((n) => [n.id, norm(n.relationshipName || n.name)]),
  );

  const setById = new Map(sets.map((s) => [s.id, s]));
  const setOf = new Map<Id, EntitySet>();
  for (const e of d.edges) {
    if (e.kind !== 'member-of') continue;
    const owner = setById.get(e.target);
    const instance = instances.find((i) => i.id === e.source);
    if (owner && instance) setOf.set(instance.id, owner);
  }

  const instancesOf = new Map<Id, Instance[]>();
  for (const i of instances) {
    const owner = setOf.get(i.id);
    if (!owner) continue;
    instancesOf.set(owner.id, [...(instancesOf.get(owner.id) ?? []), i]);
  }

  const setsByEntity = new Map<string, EntitySet[]>();
  for (const s of sets) {
    const key = norm(s.entityName || s.name);
    if (key) setsByEntity.set(key, [...(setsByEntity.get(key) ?? []), s]);
  }

  const linksByRelationship = new Map<string, Link[]>();
  const unassignedLinks: Id[] = [];
  for (const e of d.edges) {
    if (e.kind !== 'instance-link') continue;
    const a = instances.find((i) => i.id === e.source);
    const b = instances.find((i) => i.id === e.target);
    if (!a || !b) continue;
    const link: Link = { id: e.id, a, b, setA: setOf.get(a.id), setB: setOf.get(b.id) };
    const name = e.relSetId ? relSetName.get(e.relSetId) : undefined;
    if (!name) {
      unassignedLinks.push(e.id);
      continue;
    }
    linksByRelationship.set(name, [...(linksByRelationship.get(name) ?? []), link]);
  }

  return { sets, setsByEntity, instancesOf, setOf, linksByRelationship, unassignedLinks };
}

const labelOf = (i: Instance) => i.label || i.name || '(unlabelled)';

/**
 * Holds sample data against the schema it illustrates.
 *
 * This is the reason to draw an instance diagram at all. An EER diagram says
 * what may exist; these checks answer whether the rows you have drawn are
 * actually permitted — and, read the other way, whether the constraint you
 * wrote says what you meant. A 1:N you can legally violate is a 1:N you got
 * wrong.
 */
export function checkAgainstSchema(d: Diagram, schema: EerDiagram): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string, targets: Id[]) =>
    issues.push({ id: `${severity}:${targets.join(',')}:${message}`, severity, message, targets });

  const ix = index(d);
  const schemaEntities = eerEntities(schema);
  const schemaRelationships = eerRelationships(schema);
  const entityByName = new Map(schemaEntities.map((e) => [norm(e.name), e]));
  const relationshipNames = new Set(schemaRelationships.map((r) => norm(r.name)));

  /* ---- correspondence with the schema ---------------------------------- */

  for (const s of ix.sets) {
    const name = norm(s.entityName || s.name);
    if (!name) continue;
    const entity = entityByName.get(name);
    if (!entity) {
      add(
        'error',
        `No entity type named “${s.entityName || s.name}” exists in the linked schema.`,
        [s.id],
      );
      continue;
    }
    if (entity.weak !== s.weak) {
      add(
        'warning',
        `“${entity.name}” is ${entity.weak ? 'a weak' : 'a strong'} entity in the schema, but this set is marked ${s.weak ? 'weak' : 'strong'}.`,
        [s.id],
      );
    }
  }

  for (const n of d.nodes) {
    if (n.kind !== 'rel-set') continue;
    const name = norm(n.relationshipName || n.name);
    if (name && !relationshipNames.has(name)) {
      add(
        'error',
        `No relationship named “${n.relationshipName || n.name}” exists in the linked schema.`,
        [n.id],
      );
    }
  }

  if (ix.unassignedLinks.length > 0) {
    add(
      'warning',
      `${ix.unassignedLinks.length} relationship link${ix.unassignedLinks.length === 1 ? ' is' : 's are'} not assigned to a relationship set, so ${ix.unassignedLinks.length === 1 ? 'it cannot' : 'they cannot'} be checked.`,
      ix.unassignedLinks,
    );
  }

  /* ---- one relationship at a time -------------------------------------- */

  for (const r of schemaRelationships) {
    const parts = participantsOf(schema, r.id);
    const links = ix.linksByRelationship.get(norm(r.name)) ?? [];

    if (parts.length > 2) {
      if (links.length > 0) {
        add(
          'info',
          `“${r.name}” is ${parts.length}-ary. Instance links join two instances, so it is not checked here.`,
          links.map((l) => l.id),
        );
      }
      continue;
    }
    if (parts.length !== 2) continue;

    const [p1, p2] = parts;
    const recursive = p1.entity.id === p2.entity.id;

    // Every link must actually join the two entity types the schema names.
    for (const link of links) {
      const names = [link.setA, link.setB].map((s) => (s ? norm(s.entityName || s.name) : ''));
      const wanted = [norm(p1.entity.name), norm(p2.entity.name)].sort();
      if ([...names].sort().join('|') !== wanted.join('|')) {
        add(
          'error',
          `A “${r.name}” link joins ${link.setA?.name ?? '?'} to ${link.setB?.name ?? '?'}, but the schema relates ${p1.entity.name} to ${p2.entity.name}.`,
          [link.id],
        );
      }
    }

    if (recursive) {
      if (links.length > 0) {
        add(
          'info',
          `“${r.name}” is recursive, so which end plays which role cannot be read off a link. Its cardinality is not checked.`,
          links.map((l) => l.id),
        );
      }
      continue;
    }

    // How many links each instance takes part in.
    const degree = new Map<Id, number>();
    for (const link of links) {
      degree.set(link.a.id, (degree.get(link.a.id) ?? 0) + 1);
      degree.set(link.b.id, (degree.get(link.b.id) ?? 0) + 1);
    }

    const [f1, f2] = functionalSides(p1.edge, p2.edge);
    const sides = [
      { part: p1, functional: f1 },
      { part: p2, functional: f2 },
    ];

    for (const { part, functional } of sides) {
      const sets = ix.setsByEntity.get(norm(part.entity.name)) ?? [];
      const instances = sets.flatMap((s) => ix.instancesOf.get(s.id) ?? []);

      for (const i of instances) {
        const count = degree.get(i.id) ?? 0;

        // The heart of it: on the side the schema says is single-valued, one
        // instance may take part at most once.
        if (functional && count > 1) {
          add(
            'error',
            `${part.entity.name} “${labelOf(i)}” takes part in ${count} “${r.name}” links, but the schema allows at most one.`,
            [i.id],
          );
        }

        if (isTotal(part.edge) && count === 0) {
          add(
            'error',
            `${part.entity.name} “${labelOf(i)}” takes part in no “${r.name}”, but its participation is total.`,
            [i.id],
          );
        }

        if (part.edge.showMinMax) {
          const min = part.edge.min ?? 0;
          const max = part.edge.max ?? null;
          if (count < min) {
            add(
              'error',
              `${part.entity.name} “${labelOf(i)}” takes part in ${count} “${r.name}” links; the constraint is (${min},${max ?? 'N'}).`,
              [i.id],
            );
          } else if (max !== null && count > max) {
            add(
              'error',
              `${part.entity.name} “${labelOf(i)}” takes part in ${count} “${r.name}” links; the constraint is (${min},${max}).`,
              [i.id],
            );
          }
        }
      }
    }
  }

  /* ---- weak entities ---------------------------------------------------- */

  for (const entity of schemaEntities) {
    if (!entity.weak) continue;
    const owner = identifyingOwner(schema, entity.id);
    if (!owner) continue;
    const sets = ix.setsByEntity.get(norm(entity.name)) ?? [];
    const instances = sets.flatMap((s) => ix.instancesOf.get(s.id) ?? []);
    const links = ix.linksByRelationship.get(norm(owner.rel.name)) ?? [];

    for (const i of instances) {
      const count = links.filter((l) => l.a.id === i.id || l.b.id === i.id).length;
      if (count !== 1 && links.length + instances.length > 0) {
        add(
          count === 0 ? 'error' : 'error',
          `Weak ${entity.name} “${labelOf(i)}” is identified by ${count} ${owner.owner.name} link${count === 1 ? '' : 's'}; it needs exactly one.`,
          [i.id],
        );
      }
    }
  }

  /* ---- specialisation --------------------------------------------------- */

  for (const isa of isaNodes(schema)) {
    const sup = superclassOf(schema, isa.id);
    const subs = subclassesOf(schema, isa.id);
    if (!sup || subs.length === 0) continue;

    const labelsIn = (entity: EntityNode) =>
      new Set(
        (ix.setsByEntity.get(norm(entity.name)) ?? [])
          .flatMap((s) => ix.instancesOf.get(s.id) ?? [])
          .map((i) => norm(labelOf(i))),
      );

    const superLabels = labelsIn(sup);
    const superDrawn = (ix.setsByEntity.get(norm(sup.name)) ?? []).length > 0;
    const subLabelSets = subs.map((s) => ({ entity: s, labels: labelsIn(s) }));

    // A subclass member is a superclass member; if you drew both sets, the
    // instance has to appear in each.
    if (superDrawn) {
      for (const { entity, labels } of subLabelSets) {
        for (const label of labels) {
          if (!superLabels.has(label)) {
            const offenders = (ix.setsByEntity.get(norm(entity.name)) ?? [])
              .flatMap((s) => ix.instancesOf.get(s.id) ?? [])
              .filter((i) => norm(labelOf(i)) === label);
            add(
              'error',
              `“${label}” is in ${entity.name} but not in its superclass ${sup.name}; every subclass member is a member of the superclass.`,
              offenders.map((i) => i.id),
            );
          }
        }
      }
    }

    if (isa.disjoint && subLabelSets.length > 1) {
      const seen = new Map<string, string[]>();
      for (const { entity, labels } of subLabelSets) {
        for (const label of labels) {
          seen.set(label, [...(seen.get(label) ?? []), entity.name]);
        }
      }
      for (const [label, owners] of seen) {
        if (owners.length > 1) {
          const offenders = subLabelSets
            .flatMap(({ entity }) => ix.setsByEntity.get(norm(entity.name)) ?? [])
            .flatMap((s) => ix.instancesOf.get(s.id) ?? [])
            .filter((i) => norm(labelOf(i)) === label);
          add(
            'error',
            `“${label}” appears in ${owners.join(' and ')}, but that specialisation is disjoint.`,
            offenders.map((i) => i.id),
          );
        }
      }
    }

    // Only meaningful once every subclass set has actually been drawn.
    const allSubsDrawn = subs.every(
      (s) => (ix.setsByEntity.get(norm(s.name)) ?? []).length > 0,
    );
    if (isa.total && superDrawn && allSubsDrawn) {
      const covered = new Set(subLabelSets.flatMap(({ labels }) => [...labels]));
      for (const label of superLabels) {
        if (!covered.has(label)) {
          const offenders = (ix.setsByEntity.get(norm(sup.name)) ?? [])
            .flatMap((s) => ix.instancesOf.get(s.id) ?? [])
            .filter((i) => norm(labelOf(i)) === label);
          add(
            'error',
            `${sup.name} “${label}” is in no subclass, but that specialisation is total.`,
            offenders.map((i) => i.id),
          );
        }
      }
    }
  }

  /* ---- coverage --------------------------------------------------------- */

  const drawn = new Set(ix.sets.map((s) => norm(s.entityName || s.name)));
  const missing = schemaEntities.filter((e) => !drawn.has(norm(e.name)));
  if (missing.length > 0 && ix.sets.length > 0) {
    add(
      'info',
      `Not shown from the schema: ${missing.map((e) => e.name).join(', ')}. An instance diagram need not cover everything.`,
      [],
    );
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const uniq = new Map<string, Issue>();
  for (const i of issues) uniq.set(i.id, i);
  return [...uniq.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}
