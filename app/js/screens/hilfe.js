// Governing: SPEC-0008 REQ "Family Help Page" (public, German, no addresses), ADR-0004 (nothing internal in a page that
// can be opened without signing in)
//
// The family help page (`#/hilfe`). It needs no session and no data, so it works signed out, offline and on a
// freshly installed home-screen app. The text is plain data (`SECTIONS`) so tests can check it; the screen turns it into
// native <details> sections (keyboard accessible without scripting).
//
// Block kinds: { p } paragraph, { steps } numbered steps, { list } bullet list, { note } hint.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.HH = root.HH || {};
    root.HH.hilfe = api;
    root.HH.screens = root.HH.screens || {};
    root.HH.screens.hilfe = api.screen;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const INTRO =
    "Hier steht, wie Haushelden funktioniert. Diese Seite lässt sich auch ohne Anmeldung öffnen, zum Beispiel auf einem neuen Gerät.";

  const SECTIONS = [
    {
      id: "was",
      title: "Was ist Haushelden?",
      blocks: [
        {
          p: "Haushelden ist der Familienplaner dieses Haushalts: Aufgaben zum Abhaken für die Kinder, Aufgaben und Zuständigkeiten für die Eltern, ein gemeinsamer Kalender, die Einkaufslisten, der Essensplan für die Woche und der Putztag.",
        },
        { p: "Alle Daten liegen auf dem Familienserver zu Hause. Es gibt keine Cloud und kein Tracking." },
      ],
    },
    {
      id: "installieren",
      title: "Auf dem iPhone oder iPad installieren",
      blocks: [
        {
          steps: [
            "Öffne die Adresse der Familie in Safari (nicht in einem anderen Browser).",
            "Tippe auf das Teilen-Symbol (ein Quadrat mit einem Pfeil nach oben).",
            "Wähle „Zum Home-Bildschirm“ und tippe auf „Hinzufügen“.",
            "Starte Haushelden ab jetzt über das neue Symbol auf dem Home-Bildschirm.",
          ],
        },
        {
          note: "Dann öffnet sich die App im Vollbild und zeigt auch ohne Internet die zuletzt geladenen Daten.",
        },
      ],
    },
    {
      id: "anmelden",
      title: "Anmelden: Eltern und Kinder",
      blocks: [
        {
          list: [
            "Eltern melden sich mit E-Mail und Passwort an (mindestens 12 Zeichen).",
            "Das Kinder-iPad richtet ein Elternteil einmal ein: Unter „Wer bist du?“ auf „Als Familiengerät einrichten“ tippen und dem Gerät einen Namen geben. Danach brauchen die Kinder kein Passwort, sie tippen einfach auf ihr Gesicht.",
            "Tippt ein Kind auf ein Elternprofil, fragt das iPad nach der 6-stelligen PIN der Eltern. Die PIN gilt 15 Minuten, danach zeigt das iPad wieder die Kinderansicht.",
          ],
        },
      ],
    },
    {
      id: "tagesliste",
      title: "Die Tagesliste der Kinder",
      blocks: [
        {
          list: [
            "Jede Kachel ist eine Aufgabe für heute. Einmal antippen heißt: erledigt. Noch einmal antippen nimmt es zurück.",
            "Der Ring oben zeigt, wie viel schon geschafft ist. Wochenleiste und Serie zeigen die letzten Tage.",
            "Unter „Morgen“ steht, was morgen ansteht, zum Beispiel was für das Hobby eingepackt werden muss.",
            "Das Maskottchen freut sich mit und spricht ab und zu. Wenn alles erledigt ist, gibt es ein kleines Fest.",
            "Den Ton kannst du auf der Tagesliste ein- und ausschalten.",
          ],
        },
        {
          note: "Die Stimme kommt vom iPad. Eine natürlichere deutsche Stimme lässt sich in den iPad-Einstellungen unter „Bedienungshilfen › Gesprochene Inhalte › Stimmen“ laden.",
        },
      ],
    },
    {
      id: "eltern",
      title: "Aufgaben für die Eltern",
      blocks: [
        {
          list: [
            "Unter „Aufgaben“ schreibst du eine neue Aufgabe, wählst die Fälligkeit (heute oder morgen) und für wen sie ist: für dich, für den anderen Elternteil oder für beide.",
            "Tippe eine Aufgabe an, um Titel, Datum, Zuständigen und Bereich zu ändern oder sie zu löschen.",
            "Bereiche sind Themen wie „Auto“ oder „Haus & Garten“ mit einer zuständigen Person. Tippe einen Bereich an, um nur dessen Aufgaben zu sehen. Die Zuständigkeiten legst du unter „Bereiche bearbeiten“ fest.",
            "„Routine heute“ zeigt die wiederkehrenden Aufgaben, die heute für dich dran sind.",
            "Oben wechselst du zwischen Liste und Kalender. Der Kalender zeigt die Familie auf einen Blick: Aufgaben mit Datum, die Hobbys der Kinder und eure Routinen.",
          ],
        },
      ],
    },
    {
      id: "einkaufen",
      title: "Einkaufen",
      blocks: [
        {
          list: [
            "Es gibt zwei Listen: Lebensmittel und dm. Jeder darf etwas draufschreiben, auch die Kinder.",
            "Im Laden abhaken heißt: gekauft. Mit „Einkauf fertig“ räumen die Eltern die abgehakten Sachen weg.",
            "Haushelden merkt sich, wie oft ihr etwas kauft, und setzt es von selbst wieder auf die Liste, mit ✨ und dem Grund. Entfernst du so etwas ungekauft, kommt es erst später wieder.",
            "Beim Tippen schlägt die App Dinge vor, die ihr schon früher gekauft habt.",
          ],
        },
      ],
    },
    {
      id: "essen",
      title: "Essen planen",
      blocks: [
        {
          list: [
            "Unter „Essen“ siehst du die Woche von Montag bis Sonntag, mit Mittagessen und Abendessen für jeden Tag. Heute ist farbig hervorgehoben. Mit den Pfeilen blätterst du durch die Wochen, „Diese Woche“ bringt dich zurück.",
            "Tippe auf „+ eintragen“ und schreib, was es gibt. Beim Tippen schlägt die App Gerichte vor, die ihr schon kennt, die am längsten nicht gekocht wurden zuerst. Du kannst auch einfach etwas Neues schreiben.",
            "Die Kinder dürfen freie Plätze füllen und ihre eigenen Vorschläge ändern. Was die Eltern eingetragen haben, können nur die Eltern ändern. Wenn ein Elternteil etwas anderes einträgt, gilt das und die alten Daumen sind weg.",
            "Jeder darf pro Mahlzeit einen Daumen hoch oder runter geben. Noch einmal tippen nimmt ihn zurück. Unter „Gerichte“ siehst du, welche Gerichte besonders gut ankommen.",
            "Die Gerichte (mit Zutaten, eine pro Zeile) legt jeder unter „Gerichte“ an. Die Eltern können mit „Zutaten auf die Liste“ alles für ein Gericht, einen Tag oder die ganze Woche auf die Einkaufsliste setzen. Was schon draufsteht, kommt nicht doppelt.",
            "Die Eltern können eine Woche auf eine andere kopieren und eine Woche leeren. Beim Kopieren in eine Woche, die nicht leer ist, fragt die App, ob sie ersetzen oder nur freie Plätze füllen soll.",
            "Auf der Kinderseite und bei „Wer bist du?“ steht, was es heute gibt.",
          ],
        },
      ],
    },
    {
      id: "putztag",
      title: "Putztag",
      blocks: [
        {
          list: [
            "Unter „Putztag“ steht die Liste für den Familien-Putztag. Alle sehen die ganze Liste, sortiert nach Personen, und oben, wie viel schon geschafft ist.",
            "Hake ab, was du erledigt hast. Kinder können nur ihre eigenen Aufgaben abhaken, die der anderen sehen sie, aber sie sind grau. Die Eltern können alles abhaken. Noch einmal tippen nimmt es zurück.",
            "Die Eltern legen den Putztag an: „Putztag anlegen“, Datum wählen (vorgeschlagen ist der nächste Samstag). Dann kommen alle Standard-Aufgaben auf die Liste. Aufgaben für „Jedes Kind“ bekommt jedes Kind einmal. Legst du einen Tag zweimal an, kommt nichts doppelt.",
            "Unter „Standard-Aufgaben“ stehen die üblichen Aufgaben. Beim ersten Mal übernehmen die Eltern die Standardliste und sagen, wer Papas und wer Mamas Liste macht. Danach kann alles geändert, gelöscht und ergänzt werden. Seltene Aufgaben (zum Beispiel „Staubsaugerfilter reinigen“) lassen sich auf alle 2 Wochen oder monatlich stellen.",
            "Mit dem Stift an einer Aufgabe ändern die Eltern den Text oder wer sie macht. „+ Aufgabe hinzufügen“ ist für etwas, das nur an diesem Tag dran ist.",
            "Am Putztag steht auf der Kinderseite und bei „Wer bist du?“ eine Zeile dazu.",
          ],
        },
      ],
    },
    {
      id: "offline",
      title: "Ohne Internet",
      blocks: [
        {
          list: [
            "Die App öffnet sich auch ohne Netz und zeigt die zuletzt geladenen Daten.",
            "Abhaken und Aufschreiben geht weiter. Die Änderungen werden gesendet, sobald wieder Verbindung da ist.",
            "Steht unten „nicht synchronisiert“, sind noch Änderungen unterwegs. Das verschwindet von selbst.",
          ],
        },
      ],
    },
    {
      id: "einstellungen",
      title: "Einstellungen (nur Eltern)",
      blocks: [
        {
          list: [
            "Mitglieder: Namen, Symbol und Farbe ändern, Kinder hinzufügen oder entfernen.",
            "Meine PIN: setzen oder ändern. Dafür gibst du dein Passwort noch einmal ein.",
            "Geräte: eingerichtete Familiengeräte ansehen und entfernen, zum Beispiel wenn ein iPad ersetzt wird.",
            "Überall abmelden: beendet alle deine Anmeldungen, zum Beispiel nach einem verlorenen Handy.",
            "Export: lädt alle Daten der Familie als eine Datei herunter.",
            "Von hier aus erreichst du auch Routinen, Maskottchen, Bereiche und die gelernten Einkaufsgewohnheiten.",
          ],
        },
      ],
    },
    {
      id: "probleme",
      title: "Wenn etwas nicht klappt",
      blocks: [
        {
          list: [
            "Das Kinder-iPad zeigt die Anmeldung: Das Gerät wurde entfernt oder die Daten der App wurden gelöscht. Ein Elternteil meldet sich an und richtet es unter „Wer bist du?“ neu ein.",
            "PIN vergessen: In den Einstellungen unter „Meine PIN“ eine neue setzen (mit deinem Passwort).",
            "Handy verloren: Auf einem anderen Gerät „Überall abmelden“.",
            "Die Seite ist leer oder sieht veraltet aus: Schließe die App ganz und öffne sie neu.",
            "Passwort vergessen: Das lässt sich in der App noch nicht zurücksetzen. Wendet euch an die Person, die den Familienserver betreut.",
          ],
        },
      ],
    },
    {
      id: "datenschutz",
      title: "Datenschutz",
      blocks: [
        {
          p: "Eure Daten liegen auf dem Familienserver zu Hause und werden dort regelmäßig gesichert. Es gibt keine Werbung, kein Tracking und keine Weitergabe an Dritte.",
        },
        {
          p: "Auf dem Gerät speichert die App eine Kopie der Daten, damit sie auch ohne Internet funktioniert. Wechselt auf einem Gerät die angemeldete Person, wird diese Kopie geleert.",
        },
      ],
    },
    {
      id: "bald",
      title: "Was noch nicht geht",
      blocks: [
        {
          list: [
            "Erinnerungen als Mitteilung auf dem Handy",
            "Das Passwort in der App ändern oder zurücksetzen",
            "Der iCloud-Kalender der Familie in der Kalenderansicht",
          ],
        },
      ],
    },
  ];

  function h(doc, tag, className, text) {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function block(doc, b) {
    if (b.p) return h(doc, "p", "", b.p);
    if (b.note) return h(doc, "p", "muted", b.note);
    const list = h(doc, b.steps ? "ol" : "ul", "help-list");
    for (const text of b.steps || b.list) list.append(h(doc, "li", "", text));
    return list;
  }

  /** The whole page as a DOM tree: heading, intro and one <details> per section (the first one open). */
  function buildHelp(doc) {
    const rootEl = h(doc, "div", "hilfe");
    rootEl.append(h(doc, "h1", "", "Hilfe"), h(doc, "p", "muted", INTRO));
    SECTIONS.forEach((section, i) => {
      const details = h(doc, "details", "help-section");
      details.setAttribute("data-section", section.id);
      if (i === 0) details.setAttribute("open", "");
      details.append(h(doc, "summary", "", section.title));
      for (const b of section.blocks) details.append(block(doc, b));
      rootEl.append(details);
    });
    return rootEl;
  }

  function screen(view) {
    view.append(buildHelp(view.ownerDocument));
  }

  return { SECTIONS, INTRO, buildHelp, screen };
});
