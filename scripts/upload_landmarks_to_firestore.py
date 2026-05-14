import firebase_admin
from firebase_admin import credentials, firestore


# ============================
# 1. Initialize Firebase Admin SDK
# ============================
# Replace this with your actual service account key path.
SERVICE_ACCOUNT_PATH = "./ka-kalakbay-firebase-adminsdk-fbsvc-7e52a5aadf.json"

# This is the Firestore collection where landmark documents will be saved.
COLLECTION_NAME = "landmarks"

cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
firebase_admin.initialize_app(cred)
db = firestore.client()


# ============================
# 2. Landmark data
# ============================
# Each object in LANDMARKS becomes one Firestore document.
# The document ID will use the landmark's "id".
LANDMARKS = [
    {
        "id": "house",
        "name": "House",
        "category": "House",
        "icon": "🗿",
        "lat": 14.84536639928283,
        "lng": 120.28255710811561,
        "color": "#27667B",
        "image": "assets/images/house.jpg",
        "desc": "House",
        "xp": 100,
        "visited": False,
        "_notified": False,
    }
]


# ============================
# 3. Validate landmark object
# ============================
def validate_landmark(landmark):
    """
    Checks that the landmark has the minimum fields needed for Firestore upload.
    """
    required_fields = ["id", "name", "lat", "lng"]

    for field in required_fields:
        if field not in landmark:
            raise ValueError(f"Missing required field '{field}'")

    if not str(landmark["id"]).strip():
        raise ValueError("Landmark id cannot be empty")


# ============================
# 4. Upload landmarks to Firestore
# ============================
def upload_landmarks(collection_name=COLLECTION_NAME):
    """
    Uploads each landmark as one document in Firestore.

    Example:
      Collection: landmarks
      Document: ulo-ng-apo
      Data: full landmark object
    """
    try:
        collection_ref = db.collection(collection_name)

        for landmark in LANDMARKS:
            validate_landmark(landmark)

            doc_id = landmark["id"]
            doc_ref = collection_ref.document(doc_id)

            # merge=True keeps existing extra fields if a document already exists.
            doc_ref.set(landmark, merge=True)

            print(f"[OK] Uploaded '{landmark['name']}'")
            print(f"     Collection: {collection_name}")
            print(f"     Document ID: {doc_id}")

        print(f"[DONE] Uploaded {len(LANDMARKS)} landmark documents.")

    except Exception as e:
        print(f"[ERROR] Unexpected error: {e}")


# ============================
# 5. Run the upload
# ============================
if __name__ == "__main__":
    upload_landmarks()
