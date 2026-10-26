import os
from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings

DATA_PATH = "data"

def load_documents():
    docs = []

    for root, dirs, files in os.walk(DATA_PATH):
        for file in files:
            path = os.path.join(root, file)

            try:
                if file.endswith(".pdf"):
                    docs.extend(PyPDFLoader(path).load())
                    print(f"PDF chargé : {file}")

                elif file.endswith(".docx"):
                    docs.extend(Docx2txtLoader(path).load())
                    print(f"DOCX chargé : {file}")

            except Exception as e:
                print(f"⚠️ Fichier ignoré : {file} -> {e}")

    return docs

documents = load_documents()

text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=200
)

chunks = text_splitter.split_documents(documents)

# ⭐ embeddings GRATUITS
embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

vectorstore = FAISS.from_documents(chunks, embeddings)
vectorstore.save_local("vector_db")

print("Base créée gratuitement ✔")