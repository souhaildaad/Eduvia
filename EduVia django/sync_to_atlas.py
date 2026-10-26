"""
Script de synchronisation de la base MongoDB locale (127.0.0.1:27017/eduvia)
vers MongoDB Atlas (Cloud) pour le déploiement sur Render + Vercel.

Utilisation :
  .venv\\Scripts\\python.exe sync_to_atlas.py "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
"""
import os
import sys
from pymongo import MongoClient, ReplaceOne


def sync_local_to_atlas(atlas_uri: str, db_name: str = 'eduvia'):
    local_uri = os.environ.get('LOCAL_MONGODB_URI', 'mongodb://127.0.0.1:27017')
    print(f'Connexion a la base locale ({local_uri}/{db_name})...')
    local_client = MongoClient(local_uri, serverSelectionTimeoutMS=5000)
    local_db = local_client[db_name]

    print('Connexion a MongoDB Atlas...')
    atlas_client = MongoClient(atlas_uri, serverSelectionTimeoutMS=15000)
    atlas_db = atlas_client[db_name]

    collections = [
        name for name in local_db.list_collection_names()
        if not name.startswith('system.')
    ]
    print(f'{len(collections)} collections trouvees : {", ".join(collections)}')

    total_copied = 0
    for col_name in collections:
        docs = list(local_db[col_name].find({}))
        if not docs:
            continue
        target_col = atlas_db[col_name]
        ops = [ReplaceOne({'_id': doc['_id']}, doc, upsert=True) for doc in docs]
        target_col.bulk_write(ops, ordered=False)
        total_copied += len(docs)
        print(f'  [OK] {col_name} : {len(docs)} document(s) synchronise(s)')

    print(f'\nSynchronisation terminee avec succes ({total_copied} documents copies vers MongoDB Atlas) !')


if __name__ == '__main__':
    uri = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('MONGODB_ATLAS_URI', '').strip()
    if not uri:
        print('Usage: .venv\\Scripts\\python.exe sync_to_atlas.py "mongodb+srv://..."')
        sys.exit(1)
    sync_local_to_atlas(uri)

