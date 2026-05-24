import firebase_admin
from firebase_admin import credentials, firestore


# Replace this with your actual service account key path.
SERVICE_ACCOUNT_PATH = "./ka-kalakbay-firebase-adminsdk-fbsvc-7e52a5aadf.json"
COLLECTION_NAME = "landmarks"

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()


landmarks_data = {
    "house": {
        "desc": "The Ulo ng Apo Monument represents the legend and identity behind Olongapo’s name. More than a public sculpture, it serves as a cultural symbol that connects the city to its folklore, memory, and local pride.",
        "history": "The current Ulo ng Apo Monument was built in the early 1980s at the Rizal Avenue rotunda, replacing the earlier Lions Rotunda from the 1960s. It represents the folklore behind Olongapo’s name, which means “Head of the Elder,” honoring the legend of a wise leader who united his village.",
        "arInfo": [
            "Built in the early 1980s at the Rizal Avenue rotunda.",
            "Replaced the older Lions Rotunda from the 1960s.",
            "Represents the folklore behind Olongapo’s name, meaning “Head of the Elder.”",
            "Honors the legend of a wise leader who united his village."
        ]
    }
}


def update_landmark_ar_information(collection_name=COLLECTION_NAME):
    collection_ref = db.collection(collection_name)
    updated_count = 0
    skipped_count = 0

    for landmark_id, data in landmarks_data.items():
        doc_ref = collection_ref.document(landmark_id)
        doc_snapshot = doc_ref.get()

        if not doc_snapshot.exists:
            print(f"Skipped: {landmark_id} does not exist")
            skipped_count += 1
            continue

        update_payload = {
            "desc": data["desc"],
            "history": data["history"],
            "arInfo": data["arInfo"],
            "description": firestore.DELETE_FIELD
        }

        doc_ref.update(update_payload)
        updated_count += 1
        print(f"Updated: {landmark_id}")

    print(f"Done. Updated {updated_count} document(s), skipped {skipped_count}.")


if __name__ == "__main__":
    update_landmark_ar_information()
