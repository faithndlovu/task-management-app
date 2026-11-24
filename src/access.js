/** Shared access-control helpers for projects and tasks. */
function makeAccess(db) {
  const getProject = db.prepare('SELECT * FROM projects WHERE id = ?');
  const isMember = db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?');

  function canViewProject(user, project) {
    if (!project) return false;
    if (user.role === 'admin') return true;
    return project.owner_id === user.id || !!isMember.get(project.id, user.id);
  }

  function canManageProject(user, project) {
    if (!project) return false;
    if (user.role === 'admin') return true;
    return user.role === 'manager' && (project.owner_id === user.id || !!isMember.get(project.id, user.id));
  }

  function isProjectParticipant(projectId, userId) {
    const p = getProject.get(projectId);
    return !!p && (p.owner_id === userId || !!isMember.get(projectId, userId));
  }

  /** SQL fragment + params restricting projects to those visible to the user. */
  function visibleProjectsClause(user, alias = 'p') {
    if (user.role === 'admin') return { sql: '1=1', params: [] };
    return {
      sql: `(${alias}.owner_id = ? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ${alias}.id AND pm.user_id = ?))`,
      params: [user.id, user.id],
    };
  }

  return { getProject, canViewProject, canManageProject, isProjectParticipant, visibleProjectsClause };
}

module.exports = { makeAccess };
