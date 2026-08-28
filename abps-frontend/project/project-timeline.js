// project/project-timeline.js — Project Timeline Tracking (Project
// department, after Manufacturing Clearance). Nav/permission plumbing
// only for now: perm_project_timeline, the menu card, and this canvas
// panel exist end-to-end, but the real screen (the branching schematic
// design already agreed on) isn't built yet. Ships in a later pass —
// see the design discussion for Stages 1-5, business-day math, and the
// per-department write-gating model.
function initializeProjectTimelinePanel() {
  const mount = document.getElementById("ptl-mount");
  if (!mount) return;
  mount.innerHTML = `
    <div style="padding:40px 20px; text-align:center;">
      <div style="font-size:3rem; margin-bottom:16px;">🚧</div>
      <p style="font-size:0.9rem; color:var(--muted); max-width:480px; margin:0 auto;">
        This screen is under construction. It will track a project end to end —
        Order Acceptance through Dispatch — across Marketing, Design, Project,
        Store, Purchase, Production, and QA.
      </p>
    </div>`;
}
