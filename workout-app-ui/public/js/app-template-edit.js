// Edit a template built from the exercise list (switch "templateEdit").
//
// Such a template has no logged workout behind it, so the Edit action had
// nothing to open and only suggested Duplicate + Delete. This opens the same
// builder that created it, filled with its name and exercises; the user adds,
// removes or reorders, and "Save Template" replaces the list on the server
// (PUT /api/templates/<id>/exercises). The template keeps its id, so its folder,
// archive state and "last done" date stay as they were.
//
// The id rides on activeWorkout.editTemplateId, so the builder's existing
// start, cancel and save paths reset it along with the rest of the workout.

async function startTemplateEdit(tpl) {
  if (blockIfWorkoutRunning("editing a template")) return;
  let names;
  try {
    names = (await apiGet(`/api/templates/${tpl.id}/exercises`)).exercises;
  } catch (err) {
    alert("Can't edit this template right now (offline?).");
    return;
  }
  await startTemplateBuilder();
  activeWorkout.name = tpl.name;
  activeWorkout.exercises = names.slice();
  activeWorkout.editTemplateId = tpl.id;
  persistActiveWorkout();
  renderActiveScreen();
}

// Called by saveAsTemplate when the builder was opened by startTemplateEdit.
function saveEditedTemplate(name, exerciseNames) {
  return apiPut(`/api/templates/${activeWorkout.editTemplateId}/exercises`, {
    name,
    exercise_names: exerciseNames,
  });
}
