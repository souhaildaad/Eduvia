from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_ollama import OllamaLLM

# embeddings
embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

db = FAISS.load_local(
    "vector_db",
    embeddings,
    allow_dangerous_deserialization=True
)

retriever = db.as_retriever(search_kwargs={"k": 4})

llm = OllamaLLM(model="llama3")

print("🤖 Chatbot prêt ! (exit pour quitter)")

while True:
    query = input("\nToi : ")

    if query.lower() == "exit":
        break

    docs = retriever.invoke(query)

    context = "\n\n".join([d.page_content for d in docs])

    prompt = f"""
Tu es un assistant. Répond uniquement avec le contexte.

Contexte:
{context}

Question:
{query}
"""

    response = llm.invoke(prompt)

    print("\nBot :", response)