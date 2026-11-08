// Convenience re-exports so feature modules import access helpers from one place.
export { CurrentUser, RequirePerm, Kinds, assertCan, branchWhere, branchesFor, canAny, isStaff } from './auth';
export { can } from '@cc/shared';
