from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

def chunk_files(files: list[dict]) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=500
    )

    docs = []
    for file in files:
        chunks = splitter.create_documents(
            texts=[file["content"]],
            metadatas=[{"source": file["path"]}]
        )
        docs.extend(chunks)

    return docs