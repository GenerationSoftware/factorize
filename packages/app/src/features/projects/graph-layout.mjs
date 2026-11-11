const JOB_GAP_X = 130;
const JOB_GAP_Y = 38;
const LEFT = 300;
const TOP = 40;
const WEBHOOK_LEFT = 35;
const WEBHOOK_GAP = 30;

const jobWidth = 220;
const jobHeight = 112;
const webhookWidth = 145;
const webhookHeight = 70;

const byId = (a, b) => a.id.localeCompare(b.id);

function stronglyConnectedComponents(ids, edges) {
  const adjacency = new Map(ids.map(id => [id, []]));
  for (const edge of edges) if (adjacency.has(edge.source) && adjacency.has(edge.target)) adjacency.get(edge.source).push(edge.target);
  for (const targets of adjacency.values()) targets.sort();
  let nextIndex = 0;
  const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
  function visit(id) {
    indices.set(id, nextIndex); low.set(id, nextIndex++); stack.push(id); onStack.add(id);
    for (const target of adjacency.get(id)) {
      if (!indices.has(target)) { visit(target); low.set(id, Math.min(low.get(id), low.get(target))); }
      else if (onStack.has(target)) low.set(id, Math.min(low.get(id), indices.get(target)));
    }
    if (low.get(id) === indices.get(id)) {
      const component = [];
      let member;
      do { member = stack.pop(); onStack.delete(member); component.push(member); } while (member !== id);
      component.sort(); components.push(component);
    }
  }
  for (const id of [...ids].sort()) if (!indices.has(id)) visit(id);
  return components;
}

/**
 * Deterministic layered layout. Enabled automatic and manual job connections define ranks;
 * disabled connections stay visible but do not pull jobs into misleading positions.
 * @param {{id:string,type:string,label:string}[]} nodes
 * @param {{source:string,target:string,enabled:boolean}[]} edges
 * @returns {Map<string,{x:number,y:number}>}
 */
export function positionProjectGraph(nodes, edges) {
  const jobs = nodes.filter(node => node.type === "job").sort(byId);
  const jobIds = new Set(jobs.map(node => node.id));
  const activeEdges = edges.filter(edge => edge.enabled && jobIds.has(edge.source) && jobIds.has(edge.target));
  const components = stronglyConnectedComponents(jobs.map(node => node.id), activeEdges);
  const componentOf = new Map();
  components.forEach((component, index) => component.forEach(id => componentOf.set(id, index)));
  const outgoing = components.map(() => new Set()), indegree = components.map(() => 0);
  for (const edge of activeEdges) {
    const from = componentOf.get(edge.source), to = componentOf.get(edge.target);
    if (from !== to && !outgoing[from].has(to)) { outgoing[from].add(to); indegree[to]++; }
  }
  const componentKey = components.map(component => component[0]);
  const ready = components.map((_, index) => index).filter(index => indegree[index] === 0).sort((a, b) => componentKey[a].localeCompare(componentKey[b]));
  const rank = components.map(() => 0), topological = [];
  while (ready.length) {
    const current = ready.shift(); topological.push(current);
    for (const next of [...outgoing[current]].sort((a, b) => componentKey[a].localeCompare(componentKey[b]))) {
      rank[next] = Math.max(rank[next], rank[current] + 1);
      if (--indegree[next] === 0) { ready.push(next); ready.sort((a, b) => componentKey[a].localeCompare(componentKey[b])); }
    }
  }
  // The condensation graph is acyclic. This fallback keeps malformed/empty input safe.
  for (const index of components.map((_, i) => i)) if (!topological.includes(index)) topological.push(index);
  const layers = new Map();
  for (const node of jobs) {
    const value = rank[componentOf.get(node.id)];
    layers.set(value, [...(layers.get(value) ?? []), node]);
  }
  for (const layer of layers.values()) layer.sort(byId);
  const rankKeys = [...layers.keys()].sort((a, b) => a - b);
  let order = new Map(rankKeys.map(key => [key, new Map(layers.get(key).map((node, index) => [node.id, index]))]));
  const neighbors = new Map(jobs.map(node => [node.id, { incoming: [], outgoing: [] }]));
  for (const edge of activeEdges) {
    neighbors.get(edge.source).outgoing.push(edge.target);
    neighbors.get(edge.target).incoming.push(edge.source);
  }
  const reorder = (key, direction) => {
    const layer = layers.get(key), previous = order.get(key);
    const updated = [...layer].sort((a, b) => {
      const positions = node => neighbors.get(node.id)[direction]
        .map(id => order.get(rank[componentOf.get(id)])?.get(id))
        .filter(value => value !== undefined);
      const pa = positions(a), pb = positions(b);
      const ba = pa.length ? pa.reduce((sum, value) => sum + value, 0) / pa.length : previous.get(a.id);
      const bb = pb.length ? pb.reduce((sum, value) => sum + value, 0) / pb.length : previous.get(b.id);
      return ba - bb || previous.get(a.id) - previous.get(b.id) || a.id.localeCompare(b.id);
    });
    layers.set(key, updated);
    order.set(key, new Map(updated.map((node, index) => [node.id, index])));
  };
  // Alternating barycentric sweeps reduce crossings while stable ties preserve permutation invariance.
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const key of rankKeys.slice(1)) reorder(key, "incoming");
    for (const key of rankKeys.slice(0, -1).reverse()) reorder(key, "outgoing");
  }

  const positions = new Map();
  const centers = new Map();
  for (const key of rankKeys) layers.get(key).forEach((node, row) => {
    const y = TOP + row * (jobHeight + JOB_GAP_Y);
    positions.set(node.id, { x: LEFT + key * (jobWidth + JOB_GAP_X), y });
    centers.set(node.id, y + jobHeight / 2);
  });

  const webhooks = nodes.filter(node => node.type === "webhook").sort((a, b) => {
    const targets = node => edges.filter(edge => edge.enabled && edge.source === node.id && centers.has(edge.target)).map(edge => centers.get(edge.target));
    const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Infinity;
    return average(targets(a)) - average(targets(b)) || a.id.localeCompare(b.id);
  });
  let lastWebhookY = TOP - WEBHOOK_GAP - webhookHeight;
  for (const node of webhooks) {
    const targets = edges.filter(edge => edge.enabled && edge.source === node.id && centers.has(edge.target)).map(edge => centers.get(edge.target));
    const desired = targets.length ? targets.reduce((sum, value) => sum + value, 0) / targets.length - webhookHeight / 2 : TOP;
    const y = Math.max(desired, lastWebhookY + webhookHeight + WEBHOOK_GAP);
    positions.set(node.id, { x: WEBHOOK_LEFT, y });
    lastWebhookY = y;
  }
  return positions;
}
