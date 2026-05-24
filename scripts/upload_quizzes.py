# -*- coding: utf-8 -*-
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVICE_ACCOUNT_PATH = PROJECT_ROOT / "./ka-kalakbay-firebase-adminsdk-fbsvc-7e52a5aadf.json"
COLLECTION_NAME = "quizzes"

QUIZZES = {
    "ulo-ng-apo": {
        "landmarkId": "ulo-ng-apo",
        "landmarkName": "Ulo ng Apo Monument",
        "question": "What does \"Ulo ng Apo\" mean?",
        "choices": [
            "Head of the Elder",
            "Old Mountain",
            "City Center",
            "Ancient Gate",
        ],
        "answer": "Head of the Elder",
        "xpReward": 50,
        "active": True,
    },
    "city-hall": {
        "landmarkId": "city-hall",
        "landmarkName": "Olongapo City Hall",
        "question": "What role does Olongapo City Hall serve?",
        "choices": [
            "Center of local government",
            "Main public market",
            "Old naval gate",
            "Tourist beach area",
        ],
        "answer": "Center of local government",
        "xpReward": 50,
        "active": True,
    },
    "columban": {
        "landmarkId": "columban",
        "landmarkName": "St. Columban Church",
        "question": "What type of landmark is St. Columban?",
        "choices": [
            "Catholic church and shrine",
            "Public park",
            "Government building",
            "Old Spanish gate",
        ],
        "answer": "Catholic church and shrine",
        "xpReward": 50,
        "active": True,
    },
    "marikit-park": {
        "landmarkId": "marikit-park",
        "landmarkName": "Marikit Park",
        "question": "What was Marikit Park originally known as?",
        "choices": [
            "Jaycee Playground",
            "Rizal Plaza",
            "Olongapo Rotunda",
            "Subic Garden",
        ],
        "answer": "Jaycee Playground",
        "xpReward": 50,
        "active": True,
    },
    "rizal-triangle": {
        "landmarkId": "rizal-triangle",
        "landmarkName": "Rizal Triangle Park",
        "question": "Who is honored by Rizal Triangle Park?",
        "choices": [
            "Dr. Jose Rizal",
            "James Gordon",
            "Ferdinand Marcos",
            "Mariqueta Lopez",
        ],
        "answer": "Dr. Jose Rizal",
        "xpReward": 50,
        "active": True,
    },
    "spanish-gate": {
        "landmarkId": "spanish-gate",
        "landmarkName": "Spanish Gate",
        "question": "What was the Spanish Gate connected to?",
        "choices": [
            "Arsenal de Olongapo",
            "Gordon College",
            "Rizal Triangle",
            "Marikit Park",
        ],
        "answer": "Arsenal de Olongapo",
        "xpReward": 50,
        "active": True,
    },
    "gordon-college": {
        "landmarkId": "gordon-college",
        "landmarkName": "Gordon College",
        "question": "What was Gordon College originally named?",
        "choices": [
            "Olongapo City Colleges",
            "Subic State University",
            "Gordon Technical School",
            "Zambales City College",
        ],
        "answer": "Olongapo City Colleges",
        "xpReward": 50,
        "active": True,
    },
}

NO_QUIZ_IDS = {"house", "home", "my-house", "test-house"}


def initialize_firestore():
    if not SERVICE_ACCOUNT_PATH.exists():
        raise FileNotFoundError(
            f"Missing service account key: {SERVICE_ACCOUNT_PATH}. "
            "Place serviceAccountKey.json in the project root before running this script."
        )

    if not firebase_admin._apps:
        cred = credentials.Certificate(str(SERVICE_ACCOUNT_PATH))
        firebase_admin.initialize_app(cred)

    return firestore.client()


def upload_quizzes():
    db = initialize_firestore()
    uploaded_count = 0

    print(f"Uploading quizzes to Firestore collection: {COLLECTION_NAME}")

    for quiz_id, data in QUIZZES.items():
        if quiz_id in NO_QUIZ_IDS:
            print(f"Skipped house quiz id: {quiz_id}")
            continue

        db.collection("quizzes").document(quiz_id).set(data, merge=True)
        uploaded_count += 1
        print(f"Uploaded quiz: {quiz_id}")

    print(f"Done. Uploaded {uploaded_count} quiz document(s).")


if __name__ == "__main__":
    upload_quizzes()
