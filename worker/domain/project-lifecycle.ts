export type LifecycleStatus="DRAFT"|"PENDING"|"LIVE"|"PAUSED"|"CLOSED";
export const lifecycleTransitions:Record<LifecycleStatus,readonly LifecycleStatus[]>={DRAFT:["PENDING"],PENDING:["DRAFT","LIVE"],LIVE:["PAUSED","CLOSED"],PAUSED:["LIVE","CLOSED"],CLOSED:[]};
export function canTransition(from:LifecycleStatus,to:LifecycleStatus){return lifecycleTransitions[from].includes(to)}
