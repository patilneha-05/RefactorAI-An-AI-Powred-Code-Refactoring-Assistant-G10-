"""
Tests for the suggestion lifecycle — specifically that accepting a suggestion
persists the change to the source file on disk (and marks the suggestion
`accepted`), while rejecting never touches the file.
"""

import os
import sqlite3


def _insert_suggestion(folder, *, suggestion_id, batch_id, lnf, lnt, replace_by, state="pending"):
    """Insert a row directly into the project's local `.airefactor.db`."""
    db = sqlite3.connect(os.path.join(folder, ".airefactor.db"))
    db.execute(
        """INSERT INTO suggestions
           (suggestion_id, suggestion_description, line_no_from, line_no_to,
            old_lines, replace_by, agent_id, batch_id, suggestion_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (suggestion_id, "test", lnf, lnt, "", replace_by, "a", batch_id, state),
    )
    db.commit()
    db.close()


def _read(folder, filename):
    with open(os.path.join(folder, filename)) as handle:
        return handle.read()


def _state(folder, suggestion_id):
    db = sqlite3.connect(os.path.join(folder, ".airefactor.db"))
    try:
        row = db.execute(
            "SELECT suggestion_state FROM suggestions WHERE suggestion_id = ?",
            (suggestion_id,),
        ).fetchone()
        return row[0] if row else None
    finally:
        db.close()


def test_accept_persists_change_to_file(client, sample_project):
    folder = sample_project["folder"]
    filename = sample_project["filename"]
    _insert_suggestion(
        folder,
        suggestion_id="sug-accept",
        batch_id="batch-1",
        lnf=2,
        lnt=3,
        replace_by="NEW2\nNEW3",
    )

    response = client.post(
        "/accept_suggestion",
        json={
            "project_id": sample_project["project_id"],
            "filename": filename,
            "suggestion_id": "sug-accept",
            "batch_id": "batch-1",
            "accept": True,
        },
        headers=sample_project["headers"],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert body["accepted"] is True
    assert body["adjustment"]["lines_added"] == 2
    assert body["adjustment"]["lines_removed"] == 2

    # The change is written to disk and the suggestion is marked accepted.
    assert _read(folder, filename) == "line1\nNEW2\nNEW3\nline4\nline5\n"
    assert _state(folder, "sug-accept") == "accepted"


def test_reject_does_not_touch_the_file(client, sample_project):
    folder = sample_project["folder"]
    filename = sample_project["filename"]
    _insert_suggestion(
        folder,
        suggestion_id="sug-reject",
        batch_id="batch-2",
        lnf=2,
        lnt=2,
        replace_by="SHOULD-NOT-APPEAR",
    )

    response = client.post(
        "/accept_suggestion",
        json={
            "project_id": sample_project["project_id"],
            "filename": filename,
            "suggestion_id": "sug-reject",
            "batch_id": "batch-2",
            "accept": False,
        },
        headers=sample_project["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["accepted"] is False

    assert _read(folder, filename) == sample_project["original"]
    assert _state(folder, "sug-reject") == "rejected"


def test_accepted_change_survives_reread(client, sample_project):
    """After an accept, a fresh /read_file returns the persisted content."""
    folder = sample_project["folder"]
    filename = sample_project["filename"]
    _insert_suggestion(
        folder,
        suggestion_id="sug-reread",
        batch_id="batch-3",
        lnf=4,
        lnt=4,
        replace_by="REPLACED-LINE",
    )

    accept = client.post(
        "/accept_suggestion",
        json={
            "project_id": sample_project["project_id"],
            "filename": filename,
            "suggestion_id": "sug-reread",
            "batch_id": "batch-3",
            "accept": True,
        },
        headers=sample_project["headers"],
    )
    assert accept.status_code == 200, accept.text

    read = client.post(
        "/read_file",
        json={"filename": filename},
        headers=sample_project["headers"],
    )
    assert read.status_code == 200, read.text
    lines = read.json()["lines"]
    assert lines["4"] == "REPLACED-LINE"


def test_accept_shifts_remaining_suggestions_in_batch(client, sample_project):
    folder = sample_project["folder"]
    filename = sample_project["filename"]
    # Accepting lines 2-3 with 3 replacement lines adds one line...
    _insert_suggestion(
        folder,
        suggestion_id="sug-first",
        batch_id="batch-4",
        lnf=2,
        lnt=3,
        replace_by="A\nB\nC",
    )
    # ...so a later pending suggestion (line 5) must shift to line 6.
    _insert_suggestion(
        folder,
        suggestion_id="sug-second",
        batch_id="batch-4",
        lnf=5,
        lnt=5,
        replace_by="X",
    )

    response = client.post(
        "/accept_suggestion",
        json={
            "project_id": sample_project["project_id"],
            "filename": filename,
            "suggestion_id": "sug-first",
            "batch_id": "batch-4",
            "accept": True,
        },
        headers=sample_project["headers"],
    )
    assert response.status_code == 200, response.text
    remaining = response.json()["remaining_suggestions"]
    assert len(remaining) == 1
    assert remaining[0]["suggestion_id"] == "sug-second"
    assert int(remaining[0]["line_no_from"]) == 6
    assert int(remaining[0]["line_no_to"]) == 6


def test_accept_requires_authentication(client, sample_project):
    response = client.post(
        "/accept_suggestion",
        json={
            "project_id": sample_project["project_id"],
            "filename": sample_project["filename"],
            "suggestion_id": "sug-accept",
            "batch_id": "batch-1",
            "accept": True,
        },
    )
    assert response.status_code == 401
