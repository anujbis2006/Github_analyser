from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document

# load once globally
embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")

def embed_and_store(docs: list[Document], persist_directory: str):
    vectorstore = Chroma.from_documents(
        documents=docs,
        embedding=embeddings,
        collection_name="github_repo",
        persist_directory=persist_directory
    )
    return vectorstore

def load_existing(persist_directory: str):
    """Reload an already-embedded collection — no chunking or API calls needed."""
    return Chroma(
        collection_name="github_repo",
        embedding_function=embeddings,
        persist_directory=persist_directory
    )