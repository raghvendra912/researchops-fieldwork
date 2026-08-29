export type LifecycleStatus="PENDING"|"LIVE"|"PAUSED"|"ID_SUBMITTED"|"INVOICED"|"CLOSED";
export const lifecycleTransitions:Record<LifecycleStatus,readonly LifecycleStatus[]>={PENDING:["LIVE"],LIVE:["PAUSED","ID_SUBMITTED"],PAUSED:["LIVE","ID_SUBMITTED"],ID_SUBMITTED:["INVOICED","LIVE"],INVOICED:["CLOSED"],CLOSED:[]};
export function canTransition(from:LifecycleStatus,to:LifecycleStatus){return lifecycleTransitions[from].includes(to)}
