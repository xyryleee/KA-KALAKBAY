import firebase_admin
from firebase_admin import credentials, firestore


SERVICE_ACCOUNT_PATH = "./ka-kalakbay-firebase-adminsdk-fbsvc-7e52a5aadf.json"
COLLECTION_NAME = "landmarks"


landmarks_data = {
    "ulo-ng-apo": {
        "desc": "The Ulo ng Apo Monument represents the legend and identity behind Olongapo’s name. More than a public sculpture, it serves as a cultural symbol that connects the city to its folklore, memory, and local pride.",
        "history": "The current Ulo ng Apo Monument was built in the early 1980s at the Rizal Avenue rotunda, replacing the earlier Lions Rotunda from the 1960s. It represents the folklore behind Olongapo’s name, which means “Head of the Elder,” honoring the legend of a wise leader who united his village."
    },
    "city-hall": {
        "desc": "Olongapo City Hall stands as the city’s main center for governance, public service, and civic administration. Found in a key public area of West Bajac-Bajac, it connects residents to essential city services and represents the heart of local leadership.",
        "history": "Olongapo City Hall began as a municipal building constructed from 1957 to 1959 using local funds. After Olongapo’s administration was transferred from the U.S. military to the Philippine government in 1959, it became the town’s official municipal hall and later served as City Hall after Olongapo became a chartered city in 1966."
    },
    "columban": {
        "desc": "St. Columban Church is one of Olongapo’s familiar religious landmarks and an important Catholic place of worship. It serves as a spiritual home for many residents and remains part of the city’s community and cultural identity.",
        "history": "The Diocesan Shrine and Parish of Saint Columban was inaugurated in 1962 under the guidance of the Irish Columban Fathers. It was established to serve naval workers and the wider Catholic community in Olongapo and Zambales, later becoming a recognized Diocesan Shrine."
    },
    "marikit-park": {
        "desc": "Marikit Park is a familiar public space where people can rest, gather, and enjoy the city atmosphere. It adds life to the community by offering an open area for leisure, casual meetups, and local outdoor activities.",
        "history": "Marikit Park was developed in the 1960s as a central recreational space in Olongapo. Originally called Jaycee Playground, it was renamed in 1966 after Mariqueta “Marikit” Lopez, wife of former Vice President Fernando Lopez, who attended the city’s inauguration."
    },
    "rizal-triangle": {
        "desc": "Rizal Triangle Park is a well-known civic landmark in Olongapo City. As an open public space, it serves as a place for gatherings, relaxation, and community moments, making it part of the city’s everyday life.",
        "history": "Rizal Triangle Park dates back to the American colonial period and is named after its triangular layout and monument to Dr. Jose Rizal. Over time, it became an important civic space, hosting public gatherings, political rallies, and events during Olongapo’s transition from a U.S. military reservation into a chartered Philippine city."
    },
    "spanish-gate": {
        "desc": "The Spanish Gate is a historic landmark that preserves a visible piece of Olongapo’s past. Its old structure reflects the city’s heritage and continues to remind visitors of the historical layers that shaped the area.",
        "history": "The Spanish Gate was built in 1885 as part of the Arsenal de Olongapo after Subic Bay was declared a Spanish naval port in 1884. It served as the west gate of the arsenal, facing the old Spanish-era settlement of Olongapo, and remains one of the city’s most visible colonial landmarks."
    },
    "gordon-college": {
        "desc": "Gordon College is a public college dedicated to providing accessible education for Olongapo students. It serves as an important academic institution where learners develop skills, leadership, and professional readiness for the future.",
        "history": "Gordon College was established on February 24, 1999 as Olongapo City Colleges to provide affordable higher education for local students. It began with 177 students and programs in Accountancy and Computer Studies, then was renamed Gordon College in 2002 to honor the Gordon family and its role in the city’s development."
    }
}


def initialize_firestore():
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def update_landmark_desc_history(db):
    print("Starting landmark desc/history update...")

    collection_ref = db.collection(COLLECTION_NAME)

    for landmark_id, data in landmarks_data.items():
        doc_ref = collection_ref.document(landmark_id)
        doc_snapshot = doc_ref.get()

        if not doc_snapshot.exists:
            print(f"Skipped: {landmark_id} does not exist")
            continue

        update_payload = {
            "desc": data["desc"],
            "history": data["history"],
            "description": firestore.DELETE_FIELD
        }

        try:
            doc_ref.update(update_payload)
            print(f"Updated: {landmark_id}")
        except Exception as error:
            print(f"Failed to update {landmark_id}: {error}")

    print("Landmark desc/history update completed.")


if __name__ == "__main__":
    firestore_db = initialize_firestore()
    update_landmark_desc_history(firestore_db)
