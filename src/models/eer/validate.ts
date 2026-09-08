import type { Diagram, Id } from './types';
import type { Issue, Severity } from '../../ecosystem/registry';
import {
  attributesOf,
  entities,
  identifyingOwner,
  isRecursive,
  isaNodes,
  isaParentOf,
  isaParentsOf,
  keyAttributes,
  nodeById,
  participantsOf,
  partialKeyAttributes,
  relationships,
  subclassesOf,
  superclassOf,
  unionCategory,
  unionNodes,
  unionSuperclasses,
} from './graph';

export type { Issue, Severity };

/**
 * Structural checks against the rules of EER modelling. These are the mistakes
 * that are easy to make on a canvas and expensive to find later, so they run
 * continuously rather than on demand.
 */
export function validate(d: Diagram): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string, targets: Id[]) =>
    issues.push({
      id: `${severity}:${targets.join(',')}:${message}`,
      severity,
      message,
      targets,
    });

  // ---- Names -------------------------------------------------------------
  const seen = new Map<string, Id[]>();
  for (const n of d.nodes) {
    if (n.kind === 'isa' || n.kind === 'union') continue;
    const label = n.name.trim().toLowerCase();
    if (!label) {
      add('error', `An unnamed ${n.kind} needs a name.`, [n.id]);
      continue;
    }
    const key = `${n.kind}:${label}`;
    seen.set(key, [...(seen.get(key) ?? []), n.id]);
  }
  for (const [key, ids] of seen) {
    if (ids.length > 1 && !key.startsWith('attribute:')) {
      const [kind, label] = key.split(':');
      add('warning', `${ids.length} ${kind}s share the name "${label}".`, ids);
    }
  }

  // ---- Entities ----------------------------------------------------------
  for (const e of entities(d)) {
    const attrs = attributesOf(d, e.id);
    const keys = keyAttributes(d, e.id);
    const subclass = isaParentOf(d, e.id);
    const isCategory = unionNodes(d).some(
      (u) => unionCategory(d, u.id)?.id === e.id,
    );

    if (attrs.length === 0 && !subclass && !isCategory) {
      add('warning', `Entity "${e.name}" has no attributes.`, [e.id]);
    }
    if (e.weak) {
      if (partialKeyAttributes(d, e.id).length === 0) {
        add(
          'error',
          `Weak entity "${e.name}" needs a partial key (discriminator).`,
          [e.id],
        );
      }
      if (!identifyingOwner(d, e.id)) {
        add(
          'error',
          `Weak entity "${e.name}" is not attached to an identifying relationship with a strong owner.`,
          [e.id],
        );
      }
      if (keys.length > 0) {
        add(
          'warning',
          `Weak entity "${e.name}" has a full key attribute; a weak entity normally borrows the owner key plus a partial key.`,
          [e.id],
        );
      }
    } else if (keys.length === 0 && !subclass && !isCategory) {
      add('error', `Entity "${e.name}" has no key attribute.`, [e.id]);
    }
  }

  // ---- Relationships -----------------------------------------------------
  for (const r of relationships(d)) {
    const parts = participantsOf(d, r.id);
    if (parts.length === 0) {
      add('error', `Relationship "${r.name}" is not connected to any entity.`, [
        r.id,
      ]);
    } else if (parts.length === 1) {
      add(
        'error',
        `Relationship "${r.name}" has only one leg; a relationship needs at least two participants.`,
        [r.id],
      );
    }
    if (isRecursive(d, r.id)) {
      const missingRoles = parts.filter((p) => !p.edge.role?.trim());
      if (missingRoles.length > 0) {
        add(
          'error',
          `Recursive relationship "${r.name}" needs a role name on every leg to tell the two sides apart.`,
          [r.id, ...missingRoles.map((p) => p.edge.id)],
        );
      }
    }
    if (r.identifying) {
      const weak = parts.filter((p) => p.entity.weak);
      if (weak.length === 0) {
        add(
          'warning',
          `Identifying relationship "${r.name}" has no weak entity attached.`,
          [r.id],
        );
      }
      if (parts.length > 2) {
        add(
          'warning',
          `Identifying relationship "${r.name}" should normally be binary.`,
          [r.id],
        );
      }
    }
    if (parts.length > 2 && attributesOf(d, r.id).some((a) => a.key)) {
      add(
        'warning',
        `Key attributes on n-ary relationship "${r.name}" are unusual; the key is normally the combination of participants.`,
        [r.id],
      );
    }
  }

  // ---- Attributes --------------------------------------------------------
  for (const n of d.nodes) {
    if (n.kind !== 'attribute') continue;
    const owners = d.edges.filter(
      (e) => e.kind === 'attribute' && e.source === n.id,
    );
    if (owners.length === 0) {
      add('error', `Attribute "${n.name}" is not attached to anything.`, [n.id]);
    } else if (owners.length > 1) {
      add(
        'error',
        `Attribute "${n.name}" is attached to ${owners.length} owners; each attribute belongs to exactly one.`,
        [n.id, ...owners.map((e) => e.id)],
      );
    }
    if (n.key && n.partialKey) {
      add(
        'error',
        `Attribute "${n.name}" is marked as both a key and a partial key.`,
        [n.id],
      );
    }
    if (n.key && n.multivalued) {
      add('error', `Key attribute "${n.name}" cannot be multivalued.`, [n.id]);
    }
    if (n.key && attributesOf(d, n.id).length > 0) {
      add(
        'info',
        `Composite key "${n.name}" will be flattened into its component columns in the generated SQL.`,
        [n.id],
      );
    }
    if (n.derived && !n.derivation?.trim()) {
      add(
        'info',
        `Derived attribute "${n.name}" has no derivation rule recorded.`,
        [n.id],
      );
    }
  }

  // ---- Specialisation ----------------------------------------------------
  for (const isa of isaNodes(d)) {
    const sup = superclassOf(d, isa.id);
    const subs = subclassesOf(d, isa.id);
    if (!sup) {
      add('error', 'A specialisation marker has no superclass attached.', [isa.id]);
    }
    if (subs.length === 0) {
      add(
        'error',
        `Specialisation${sup ? ` of "${sup.name}"` : ''} has no subclasses.`,
        [isa.id],
      );
    } else if (subs.length === 1 && isa.disjoint) {
      add(
        'info',
        `Specialisation of "${sup?.name ?? '?'}" has a single subclass, so the disjoint/overlapping constraint has no effect.`,
        [isa.id],
      );
    }
    if (sup && subs.some((s) => s.id === sup.id)) {
      add(
        'error',
        `"${sup.name}" is both the superclass and a subclass of the same specialisation.`,
        [isa.id],
      );
    }
    for (const s of subs) {
      const parents = isaParentsOf(d, s.id);
      if (parents.length > 1) {
        add(
          'info',
          `"${s.name}" is a shared subclass of ${parents.length} specialisations. That is legal EER; the SQL mapping takes its key from the first superclass.`,
          [s.id],
        );
      }
      if (keyAttributes(d, s.id).length > 0) {
        add(
          'warning',
          `Subclass "${s.name}" declares its own key; subclasses inherit the superclass key.`,
          [s.id],
        );
      }
    }
  }

  // Specialisation cycles (A ISA B ISA A).
  for (const e of entities(d)) {
    const walk = new Set<Id>([e.id]);
    let cur: Id | undefined = e.id;
    while (cur) {
      const isa = isaParentOf(d, cur);
      const sup: Id | undefined = isa ? superclassOf(d, isa.id)?.id : undefined;
      if (!sup) break;
      if (walk.has(sup)) {
        add(
          'error',
          `Specialisation cycle involving "${nodeById(d, sup)?.name ?? sup}".`,
          [sup],
        );
        break;
      }
      walk.add(sup);
      cur = sup;
    }
  }

  // ---- Union / category types -------------------------------------------
  for (const u of unionNodes(d)) {
    const cat = unionCategory(d, u.id);
    const supers = unionSuperclasses(d, u.id);
    if (!cat) {
      add('error', 'A union (category) circle has no category entity attached.', [
        u.id,
      ]);
    }
    if (supers.length < 2) {
      add(
        'error',
        `Union${cat ? ` for "${cat.name}"` : ''} needs at least two superclasses; with one it is just a specialisation.`,
        [u.id],
      );
    }
    for (const s of supers) {
      if (keyAttributes(d, s.id).length === 0) {
        add(
          'warning',
          `Union superclass "${s.name}" has no key, so the category cannot reference it.`,
          [s.id],
        );
      }
    }
  }

  // ---- Dangling edges ----------------------------------------------------
  for (const edge of d.edges) {
    if (!nodeById(d, edge.source) || !nodeById(d, edge.target)) {
      add('error', 'An edge points at a node that no longer exists.', [edge.id]);
    }
  }

  // De-duplicate: the same structural problem can be reached from two sides.
  const uniq = new Map<string, Issue>();
  for (const i of issues) uniq.set(i.id, i);
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return [...uniq.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}
