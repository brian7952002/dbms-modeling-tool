import type { Issue, Severity, ValidationContext } from '../../ecosystem/registry';
import type { Diagram, DiagramNode, Id } from './types';

const setOf = (d: Diagram, instanceId: Id): DiagramNode | undefined => {
  const edge = d.edges.find((e) => e.kind === 'member-of' && e.source === instanceId);
  return edge ? d.nodes.find((n) => n.id === edge.target) : undefined;
};

/**
 * Structural checks on the sample data itself.
 *
 * Checking it against the schema it illustrates — that a 1:N is not violated
 * by an instance joined to two owners, that total participation leaves nobody
 * unconnected — needs the source EER diagram, which arrives through
 * `context.source`. Until one is linked, only these apply.
 */
export function validate(d: Diagram, context: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string, targets: Id[]) =>
    issues.push({ id: `${severity}:${targets.join(',')}:${message}`, severity, message, targets });

  const sets = d.nodes.filter((n) => n.kind === 'entity-set');
  const instances = d.nodes.filter((n) => n.kind === 'instance');

  if (sets.length === 0 && instances.length > 0) {
    add('error', 'There are instances but no entity set to put them in.', []);
  }

  for (const s of sets) {
    if (!s.name.trim()) add('error', 'An entity set needs a name.', [s.id]);
  }

  const byName = new Map<string, Id[]>();
  for (const s of sets) {
    const key = (s.kind === 'entity-set' ? s.entityName : s.name).trim().toLowerCase();
    if (key) byName.set(key, [...(byName.get(key) ?? []), s.id]);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) {
      add('warning', `${ids.length} entity sets are both named “${name}”.`, ids);
    }
  }

  for (const i of instances) {
    const owners = d.edges.filter((e) => e.kind === 'member-of' && e.source === i.id);
    if (owners.length === 0) {
      add('error', `Instance “${i.name}” does not belong to an entity set.`, [i.id]);
    } else if (owners.length > 1) {
      add(
        'error',
        `Instance “${i.name}” belongs to ${owners.length} entity sets; an instance is a member of exactly one.`,
        [i.id, ...owners.map((e) => e.id)],
      );
    }
  }

  // Duplicate labels within one set are almost always a mistake, since the
  // label stands for the instance's key.
  const perSet = new Map<Id, Map<string, Id[]>>();
  for (const i of instances) {
    const owner = setOf(d, i.id);
    if (!owner) continue;
    const label = (i.kind === 'instance' ? i.label : i.name).trim().toLowerCase();
    if (!label) continue;
    const inner = perSet.get(owner.id) ?? new Map<string, Id[]>();
    inner.set(label, [...(inner.get(label) ?? []), i.id]);
    perSet.set(owner.id, inner);
  }
  for (const [ownerId, inner] of perSet) {
    const owner = d.nodes.find((n) => n.id === ownerId);
    for (const [label, ids] of inner) {
      if (ids.length > 1) {
        add(
          'warning',
          `“${label}” appears ${ids.length} times in ${owner?.name ?? 'one set'}; instance labels stand for keys and should be unique.`,
          ids,
        );
      }
    }
  }

  for (const e of d.edges) {
    if (e.kind !== 'instance-link') continue;
    const a = setOf(d, e.source);
    const b = setOf(d, e.target);
    if (!a || !b) {
      add(
        'warning',
        'A relationship link joins an instance that is not in any entity set.',
        [e.id],
      );
    }
  }

  if (!context.source && d.nodes.length > 0) {
    add(
      'info',
      'No source EER diagram is linked, so this data is not being checked against a schema.',
      [],
    );
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const uniq = new Map<string, Issue>();
  for (const i of issues) uniq.set(i.id, i);
  return [...uniq.values()].sort((a, b) => order[a.severity] - order[b.severity]);
}
