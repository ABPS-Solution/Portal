let currentFollowUpCount = 0;
let globalFollowUpsCacheMap = {};
let globalTasksCacheMap = {};
async function commitIsolatedFollowUpItem(leadRef, scopeNode) {
  const form = scopeNode.querySelector(".template-fup-form");
  const btn = scopeNode.querySelector(".commit-fup-btn-trigger");
  const followUpData = {
    isEdit: form.querySelector(".fup-is-edit-flag").value === "true",
    status: form.querySelector(".fup-status-select").value,
    num: form.querySelector(".fup-num-input").value,
    leadRef: leadRef, company: activeSearchCompany,
    eng: form.querySelector(".fup-eng-select").value, notes: form.querySelector(".fup-notes-input").value,
    nextDate: form.querySelector(".fup-nexttarget-input").value, nextTime: form.querySelector(".fup-nexttime-select").value,
    outcome: form.querySelector(".fup-outcome-select").value, mode: form.querySelector(".fup-mode-select").value,
    nextActionType: form.querySelector(".fup-nextaction-input").value, objectionRaised: form.querySelector(".fup-objection-input").value
  };
  if (!followUpData.eng || !followUpData.eng.trim()) return alert("Engineer Name is a compulsory field.");
  if (!followUpData.notes) return alert("Interaction Notes required.");
  
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...';
  try {
    const r = await apFetch({ 
      action: "saveFollowUp", 
      activeEngineer: appActiveOperatorIdentityString,
      followUpData 
    });
    if (r.success) { 
      form.style.display = "none"; 
      scopeNode.querySelector(".trigger-fup-open").style.display = "inline-flex"; 
      scopeNode.querySelector(".trigger-fup-close").style.display = "none";
      const fupLabelDone = scopeNode.querySelector(".fup-status-label"); if (fupLabelDone) fupLabelDone.style.display = "none";
      const timelineBox = scopeNode.querySelector(".template-timeline-box");
      if (timelineBox) timelineBox.innerHTML = '<div style="font-size:0.8rem; color:var(--brand); font-weight:600; padding:8px; display:flex; align-items:center; gap:6px;"><span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite;"></span> Creating new follow-up...</div>';
      await globalExecutionScopeReloader(leadRef, scopeNode); 
    }
  } catch(e) { alert(e.message); } finally { btn.disabled = false; btn.innerHTML = "Save Follow-Up"; }
}

async function removeIsolatedFollowUpItem(leadRef, fNum, event) {
  if(!confirm("Confirm deletion?")) return;
  
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = "Deleting...";
  
  const fupId = fNum; // fNum is now the real follow_up_id (see renderIsolatedFollowUpTimeline), not a composite string
  try {
    const r = await apFetch({ 
      action: "deleteFollowUp", 
      activeEngineer: appActiveOperatorIdentityString,
      fupId: fupId 
    });
    
    // FIXED: Catch backend authorization block
    if (!r.success) {
        alert(r.error || "An unexpected error occurred.");
        btn.disabled = false;
        btn.textContent = "Delete Follow-Up";
        return;
    }
    
    const activeScopeNode = document.getElementById('active-modules-clone-' + leadRef); 
    await globalExecutionScopeReloader(leadRef, activeScopeNode); 
    
  } catch(e) { 
    alert("Deletion failed: " + e.message); 
    btn.disabled = false;
    btn.textContent = "Delete Follow-Up";
  }
}

function renderIsolatedTaskItemsList(leadRef, list, scopeNode) {
  const box = scopeNode.querySelector(".template-task-box");
  box.innerHTML = list.length === 0 ? '<p style="color:var(--muted); font-size:0.85rem; padding:10px;">No Active Tasks</p>' : '';
  list.forEach(t => {
    let div = document.createElement("div"); div.className = "task-item-card";
    const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
    const deleteActionHtml = isAdminUser 
      ? `<button class="nav-btn-styled" id="trigger-inner-delete-task-${leadRef}-${t.id}" style="font-size:0.75rem; background:var(--warn); padding:2px 6px;">Delete</button>` 
      : `<span id="trigger-inner-delete-task-${leadRef}-${t.id}" style="display:none;"></span>`;

    const priorityColors = { "Urgent": "#b91c1c", "High": "#b45309", "Medium": "#2563eb", "Low": "#65a30d" };
    const priorityColor = priorityColors[t.priority] || "#64748b";
    div.innerHTML = `<strong>${t.type}</strong> - ${t.eng} <span style="font-size:0.68rem; font-weight:700; color:#fff; background:${priorityColor}; padding:1px 6px; border-radius:3px; margin-left:4px;">${t.priority || "Medium"}</span><br/><small>Time: ${t.shift} | Target Date: ${formatCleanDateOnly(t.targetDate)}</small>
                     <p style="font-size:0.82rem; margin-top:4px; color:var(--text); word-wrap:break-word; overflow-wrap:break-word; white-space:pre-wrap;"><strong>Desc:</strong> ${t.desc || 'None'}</p>
                     ${t.completionNotes ? `<p style="font-size:0.8rem; margin-top:4px; color:#15803d; word-wrap:break-word; overflow-wrap:break-word; white-space:pre-wrap;"><strong>Outcome:</strong> ${t.completionNotes}</p>` : ''}
                     <div style="font-size:0.75rem; font-weight:bold; color:var(--brand); margin-top:4px;">Status: ${t.status} | Assigned By: ${t.assigner || "System"}</div>
                     <div style="margin-top:8px; display:flex; gap:6px;">
                       <button class="nav-btn-styled" id="trigger-inner-edit-task-${leadRef}-${t.id}" style="font-size:0.75rem; padding:2px 6px;">Edit</button>
                       ${deleteActionHtml}
                     </div>`;
    box.appendChild(div);
    
    if (isAdminUser && document.getElementById(`trigger-inner-delete-task-${leadRef}-${t.id}`)) {
      document.getElementById(`trigger-inner-delete-task-${leadRef}-${t.id}`).onclick = function(e) { removeIsolatedTaskItem(leadRef, t.id, e); };
    }
    document.getElementById('trigger-inner-edit-task-' + leadRef + '-' + t.id).onclick = function() { editIsolatedTaskItem(leadRef, scopeNode, t); };
    document.getElementById('trigger-inner-delete-task-' + leadRef + '-' + t.id).onclick = function(e) { removeIsolatedTaskItem(leadRef, t.id, e); };
  });
}

function editIsolatedTaskItem(leadRef, scopeNode, t) {
  const taskForm = scopeNode.querySelector(".template-task-form");
  taskForm.querySelector(".task-edit-id").value = t.id; 
  taskForm.querySelector(".task-status-select").value = t.status || "Assigned";
  taskForm.querySelector(".task-eng-select").value = t.eng; 
  taskForm.querySelector(".task-assigner-select").value = t.assigner || "";
  taskForm.querySelector(".task-type-select").value = t.type; 
  taskForm.querySelector(".task-desc-input").value = t.desc;
  taskForm.querySelector(".task-shift-select").value = t.shift; 
  taskForm.querySelector(".task-targetdate-input").value = formatCleanDateOnly(t.targetDate);
  taskForm.querySelector(".task-priority-select").value = t.priority || "Medium";
  taskForm.querySelector(".task-completionnotes-input").value = t.completionNotes || "";
  taskForm.style.display = "grid"; scopeNode.querySelector(".trigger-task-open").style.display = "none";
  scopeNode.querySelector(".trigger-task-close").style.display = "inline-flex";
  const taskLabelEdit = scopeNode.querySelector(".task-status-label"); if (taskLabelEdit) taskLabelEdit.style.display = "inline";
}

async function commitIsolatedTaskItem(leadRef, scopeNode) {
  const form = scopeNode.querySelector(".template-task-form");
  const desc = form.querySelector(".task-desc-input").value;
  const btn = scopeNode.querySelector(".commit-task-btn-trigger");
  const editId = form.querySelector(".task-edit-id").value;
  const taskData = {
    id: editId || "NEW", isNew: !editId, fupNum: currentFollowUpCount, leadRef: leadRef, company: activeSearchCompany,
    engineer: form.querySelector(".task-eng-select").value, assigner: form.querySelector(".task-assigner-select").value,
    type: form.querySelector(".task-type-select").value, desc: form.querySelector(".task-desc-input").value, 
    shift: form.querySelector(".task-shift-select").value, targetDate: form.querySelector(".task-targetdate-input").value, status: form.querySelector(".task-status-select").value,
    priority: form.querySelector(".task-priority-select").value, completionNotes: form.querySelector(".task-completionnotes-input").value
  };
  if (!taskData.targetDate) return alert("Target Date required.");
  if (!desc || desc.trim() === "") return alert("Task Description is a compulsory field.");
  if (!taskData.engineer || !taskData.engineer.trim()) return alert("Assigned To (Engineer) is a compulsory field.");
  if (!taskData.assigner || !taskData.assigner.trim()) return alert("Assigned By is a compulsory field.");
  btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Saving...';
  try {
    const r = await apFetch({ 
      action: "saveTask", 
      activeEngineer: appActiveOperatorIdentityString,
      taskData 
    });
    if (r.success) { 
      form.style.display = "none"; 
      scopeNode.querySelector(".trigger-task-open").style.display = "inline-flex"; 
      scopeNode.querySelector(".trigger-task-close").style.display = "none";
      const taskLabelDone = scopeNode.querySelector(".task-status-label"); if (taskLabelDone) taskLabelDone.style.display = "none";
      const taskBox = scopeNode.querySelector(".template-task-box");
      if (taskBox) taskBox.innerHTML = '<div style="font-size:0.8rem; color:var(--brand); font-weight:600; padding:8px; display:flex; align-items:center; gap:6px;"><span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid var(--border); border-top-color:var(--brand); border-radius:50%; animation:spin 0.8s linear infinite;"></span> Creating new task...</div>';
      await globalExecutionScopeReloader(leadRef, scopeNode); 
    }
  } catch(e) { alert(e.message); } finally { btn.disabled = false; btn.innerHTML = "Save Task"; }
}

async function removeIsolatedTaskItem(leadRef, taskId, event) {
  if (!confirm("Confirm cancellation?")) return;
  
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = "Deleting...";
  
  try {
    const r = await apFetch({ 
      action: "deleteTask", 
      activeEngineer: appActiveOperatorIdentityString,
      taskId: taskId 
    });
    
    // FIXED: Catch backend authorization block
    if (!r.success) {
        alert(r.error || "An unexpected error occurred.");
        btn.disabled = false;
        btn.textContent = "Delete";
        return;
    }
    
    const activeScopeNode = document.getElementById('active-modules-clone-' + leadRef); 
    await globalExecutionScopeReloader(leadRef, activeScopeNode); 
    
  } catch(e) { 
    alert("Deletion failed: " + e.message); 
    btn.disabled = false;
    btn.textContent = "Delete";
  }
}

async function executeTaskMatrixSearch() {
  const btn = document.getElementById("task-matrix-search-btn");
  const outputNode = document.getElementById("task-matrix-results-output-node");
  if (!outputNode) return;

  const checkedEngineers = Array.from(document.querySelectorAll('input[name="taskMatrixEngineer"]:checked')).map(i => i.value);
  const checkedStatuses = Array.from(document.querySelectorAll('input[name="taskMatrixStatus"]:checked')).map(i => i.value);

  if (checkedEngineers.length === 0 && checkedStatuses.length === 0) {
    alert("Please select at least one Engineer or Task Status filter before searching.");
    return;
  }

  btn.classList.add("loading"); btn.textContent = "Filtering Tasks...";

  // Show active filters summary
  const filterDisplay = document.getElementById("task-matrix-active-filters-display");
  if (filterDisplay) {
    const parts = [];
    if (checkedEngineers.length > 0) parts.push("Engineers: " + engineerEmailsToNames(checkedEngineers).join(", "));
    if (checkedStatuses.length > 0) parts.push("Status: " + checkedStatuses.join(", "));
    filterDisplay.textContent = "Filtering for → " + parts.join(" | ");
    filterDisplay.style.display = "block";
    filterDisplay.style.color = "var(--brand)";
    filterDisplay.style.background = "var(--highlight-bg)";
    filterDisplay.style.borderColor = "var(--border)";
  }

  try {
    const data = await apFetch({ 
      action: "searchTasksMatrix", 
      activeEngineer: appActiveOperatorIdentityString,
      engineers: checkedEngineers, 
      statuses: checkedStatuses 
    });

    if (data.success) {
      outputNode.innerHTML = "";

      if (data.tasks.length === 0) {
        if (filterDisplay) {
          const parts = [];
          if (checkedEngineers.length > 0) parts.push("Engineers: " + engineerEmailsToNames(checkedEngineers).join(", "));
          if (checkedStatuses.length > 0) parts.push("Status: " + checkedStatuses.join(", "));
          filterDisplay.textContent = "No tasks found for → " + parts.join(" | ");
          filterDisplay.style.color = "var(--warn)";
          filterDisplay.style.background = "#fff5f5";
          filterDisplay.style.borderColor = "#fca5a5";
        }
        return;
      }

      data.tasks.forEach(t => {
        let card = document.createElement("div");
        card.className = "task-item-card";
        card.style.cssText = "padding:12px; border-left:4px solid var(--brand); background:#fff; margin-bottom:6px; box-shadow:0 1px 3px rgba(0,0,0,0.02);";
        const isAdminUser = localStorage.getItem("isUserAdminGlobal") === "true";
        const deleteActionHtml = isAdminUser 
          ? `<button class="nav-btn-styled" id="matrix-delete-task-btn-${t.id}" style="font-size:0.72rem; padding:3px 8px; background:var(--warn);">Delete</button>` 
          : "";

        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px dashed #edf2f7; padding-bottom:6px; margin-bottom:6px;">
            <div>
              <strong style="color:var(--brand); font-size:0.9rem;">${t.type}</strong>
              <span style="font-size:0.7rem; background:#edf2f7; padding:2px 6px; border-radius:4px; font-weight:700; margin-left:8px;">${t.status}</span>
            </div>
            <button class="nav-btn-styled" id="view-company-btn-${t.id}" onclick="toggleTaskCompanyExpand('${t.id}', '${encodeURIComponent(t.companyName)}', '${encodeURIComponent(t.personName)}')" style="font-size:0.7rem; padding:3px 10px; background:var(--brand); white-space:nowrap;">View Company</button>
          </div>
          <div style="font-size:0.8rem; line-height:1.4; color:var(--text);">
            <strong>Engineer:</strong> ${t.eng} | <strong>Assigner:</strong> ${t.assigner || "System"}<br/>
            <strong>Target Date:</strong> ${formatCleanDateOnly(t.targetDate)} | <strong>Shift:</strong> ${t.shift}<br/>
            <strong>Lead Reference:</strong> ${t.companyName} (${t.personName})
          </div>
          <div style="font-size:0.82rem; color:#4a5568; padding:6px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:4px; margin-top:6px; white-space:pre-wrap;"><strong>Description:</strong> ${t.desc || 'None'}</div>
          <div style="margin-top:10px; display:flex; gap:8px;">
            <button class="nav-btn-styled" id="matrix-edit-task-btn-${t.id}" style="font-size:0.72rem; padding:3px 8px; background:var(--accent);">Edit Task Details</button>
            ${deleteActionHtml}
          </div>
          <div id="matrix-task-form-mount-${t.id}" style="margin-top:10px; display:none;"></div>
          <div id="matrix-task-company-expand-${t.id}" style="display:none; margin-top:12px; border-top:2px solid var(--border); padding-top:10px;"></div>
        `;
        outputNode.appendChild(card);

        if (isAdminUser && document.getElementById(`matrix-delete-task-btn-${t.id}`)) {
          document.getElementById(`matrix-delete-task-btn-${t.id}`).onclick = function(e) { removeMatrixTaskFromEngine(t.id, e); };
        }
        document.getElementById(`matrix-edit-task-btn-${t.id}`).onclick = function() { injectMatrixInlineTaskForm(t, card); };
      });
    }
  } catch(e) { alert("Task matrix engine fetch error: " + e.message); } 
  finally { btn.classList.remove("loading"); btn.textContent = "Run Tasks Search"; }
}

function injectMatrixInlineTaskForm(taskItem, parentCardNode) {
  const formMount = parentCardNode.querySelector(`#matrix-task-form-mount-${taskItem.id}`);
  
  if (formMount.style.display === "block") {
    formMount.style.display = "none";
    formMount.innerHTML = "";
    return;
  }

  const templateSource = document.getElementById("reusable-child-modules-template");
  if (!templateSource) {
    console.error("Task form broken: reusable-child-modules-template not found in DOM.");
    return;
  }
  const templateClone = templateSource.cloneNode(true);
  
  const coreTaskForm = templateClone.querySelector(".template-task-form");
  
  const taskEngSelect = coreTaskForm.querySelector(".task-eng-select");
  const taskAssignerSelect = coreTaskForm.querySelector(".task-assigner-select");
  
  taskEngSelect.innerHTML = ""; taskAssignerSelect.innerHTML = "";
  // taskItem.eng/assigner are resolved display names now (from
  // fetchFollowupsAndTasksMaps' COALESCE) — match on .name, submit .email.
  cachedEngineers.forEach(eng => {
    let o1 = document.createElement("option"); o1.value = eng.email; o1.textContent = eng.name; if(taskItem.eng === eng.name) o1.selected = true; taskEngSelect.appendChild(o1);
    let o2 = document.createElement("option"); o2.value = eng.email; o2.textContent = eng.name; if(taskItem.assigner === eng.name) o2.selected = true; taskAssignerSelect.appendChild(o2);
  });

  coreTaskForm.querySelector(".task-edit-id").value = taskItem.id;
  coreTaskForm.querySelector(".task-status-select").value = taskItem.status;
  coreTaskForm.querySelector(".task-type-select").value = taskItem.type;
  coreTaskForm.querySelector(".task-desc-input").value = taskItem.desc || "";
  coreTaskForm.querySelector(".task-shift-select").value = taskItem.shift || "Morning";
  coreTaskForm.querySelector(".task-targetdate-input").value = formatCleanDateOnly(taskItem.targetDate);
  
  coreTaskForm.style.display = "grid";
  
  const commitBtn = coreTaskForm.querySelector(".commit-task-btn-trigger");
  commitBtn.onclick = async function() {
    commitMatrixTaskMutations(coreTaskForm, taskItem.leadId, commitBtn);
  };

  formMount.innerHTML = "";
  formMount.appendChild(coreTaskForm);
  formMount.style.display = "block";
}

async function commitMatrixTaskMutations(formNode, fallbackLeadId, btnNode) {
  const editId = formNode.querySelector(".task-edit-id").value;
  const desc = formNode.querySelector(".task-desc-input").value;
  const targetDate = formNode.querySelector(".task-targetdate-input").value;

  if (!targetDate) return alert("Target Date required.");
  if (!desc || desc.trim() === "") return alert("Task Description is compulsory.");

  const taskData = {
    id: editId, isNew: false, leadRef: fallbackLeadId,
    engineer: formNode.querySelector(".task-eng-select").value,
    assigner: formNode.querySelector(".task-assigner-select").value,
    type: formNode.querySelector(".task-type-select").value,
    desc: desc,
    shift: formNode.querySelector(".task-shift-select").value,
    targetDate: targetDate,
    status: formNode.querySelector(".task-status-select").value
  };

  btnNode.disabled = true; btnNode.innerHTML = 'Saving Changes...';
  try {
    const r = await apFetch({ 
      action: "saveTask", 
      activeEngineer: appActiveOperatorIdentityString,
      taskData 
    });
    if (r.success) {
      alert("Task modifications saved successfully.");
      executeTaskMatrixSearch(); 
    }
  } catch(e) { alert("Matrix Update Error: " + e.message); }
}

async function removeMatrixTaskFromEngine(taskId, event) {
  if (!confirm("Confirm task removal?")) return;
  
  const btn = event.target;
  btn.classList.add("loading");
  btn.textContent = "Deleting...";
  
  try {
    const r = await apFetch({ 
      action: "deleteTask", 
      activeEngineer: appActiveOperatorIdentityString,
      taskId: taskId 
    });
    if (r.success) { executeTaskMatrixSearch(); }
  } catch(e) { 
    alert(e.message); 
    btn.classList.remove("loading");
    btn.textContent = "Delete";
  }
}

// PERSISTENT ARCHIVE PIPELINE: Fires a network hit to log deletions, pulling them from future views permanently
async function archiveEmailLeadFromSystemDatabaseCache(messageId, elementIndex) {
  if (!confirm("Remove this email lead permanently?")) return;
  
  const cardNode = document.getElementById(`email-lead-wrapper-node-${elementIndex}`);
  const deleteBtn = event.target;
  
  deleteBtn.disabled = true; 
  deleteBtn.textContent = "Processing...";
  
  try {
    const r = await apFetch({
      action: "saveFollowUp", 
      activeEngineer: appActiveOperatorIdentityString,
      followUpData: { archiveTargetEmailIdString: messageId }
    });
    
    // FIXED: Catch backend authorization block
    if (!r.success) {
        alert(r.error || "An unexpected error occurred.");
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete";
        return;
    }
    
    if (cardNode) cardNode.remove();
    
    cachedInboundEmailLeadsArray = cachedInboundEmailLeadsArray.filter(item => item.messageIdReference !== messageId);
    try { localStorage.setItem("abps_active_email_leads_cache", JSON.stringify(cachedInboundEmailLeadsArray)); } catch(e) { /* quota — ok */ }

    const remainingCards = document.getElementById("email-leads-inbound-feed-canvas").children.length;
    if (remainingCards === 0) { renderEmailLeadsFeedInterface([]); }
    
  } catch(e) {
    alert("Connection Error: Deletion parameter could not be tracked: " + e.message);
    deleteBtn.disabled = false; 
    deleteBtn.textContent = "Delete";
  }
}

