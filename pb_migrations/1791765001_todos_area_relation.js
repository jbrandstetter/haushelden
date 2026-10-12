/* global RelationField, TextField */
// Governing: ADR-0001 (PocketBase as the household backend), SPEC-0003 REQ "Areas of Responsibility" (deleting an
// area MUST keep its to-dos, without an area), REQ "To-dos"
//
// `todos.area` was a plain text id (see 1791762000_todos.js) awaiting the `areas` collection. It becomes a
// single relation to `areas` WITHOUT cascade delete: PocketBase clears the reference of every to-do when its area
// is deleted, so the to-dos stay. Existing values are carried over when they name an existing area; a value that
// names nothing (no area could have existed before this migration) is dropped to "no area".

migrate(
  (app) => {
    const areas = app.findCollectionByNameOrId("areas");
    const todos = app.findCollectionByNameOrId("todos");

    todos.fields.getByName("area").name = "area_old";
    todos.fields.add(
      new RelationField({ name: "area", collectionId: areas.id, maxSelect: 1, cascadeDelete: false }),
    );
    app.save(todos);

    app.db().newQuery("UPDATE todos SET area = area_old WHERE area_old IN (SELECT id FROM areas)").execute();

    const fresh = app.findCollectionByNameOrId("todos");
    fresh.fields.removeByName("area_old");
    app.save(fresh);
  },
  (app) => {
    const todos = app.findCollectionByNameOrId("todos");
    todos.fields.getByName("area").name = "area_rel";
    todos.fields.add(new TextField({ name: "area", max: 15, pattern: "^([a-z0-9]{15})?$" }));
    app.save(todos);
    app.db().newQuery("UPDATE todos SET area = COALESCE(area_rel, '')").execute();
    const fresh = app.findCollectionByNameOrId("todos");
    fresh.fields.removeByName("area_rel");
    app.save(fresh);
  },
);
