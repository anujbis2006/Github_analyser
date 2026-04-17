import os
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

def get_llm():
    return ChatOpenAI(
        model="llama-3.3-70b-versatile", 
        api_key=os.getenv("XAI_API_KEY"),
        base_url="https://api.groq.com/openai/v1",
        temperature=0.3,
        max_tokens=1500
    )

def build_rag_chain(vectorstore):
    retriever = vectorstore.as_retriever(
        search_kwargs={"k": 5}
    )

    prompt = ChatPromptTemplate.from_template("""
You are an expert code analyst. Use the following code context to answer the question.
If you don't know, say so — don't make things up.

Context:
{context}

Question: {question}

Answer:
""")

    llm = get_llm()

    chain = (
        {"context": retriever, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )

    return chain

def ask(chain, question: str) -> str:
    return chain.invoke(question)