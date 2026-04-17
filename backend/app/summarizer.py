import os
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from dotenv import load_dotenv

load_dotenv()

PRIORITY_FILES = {"readme.md", "main.py", "app.py", "index.py",
                  "setup.py", "pyproject.toml", "package.json"}

def get_llm():
    return ChatOpenAI(
        model="llama-3.3-70b-versatile",
        api_key=os.getenv("XAI_API_KEY"),
        base_url="https://api.groq.com/openai/v1",
        temperature=0.3,
        max_tokens=800 
    )

def summarize_repo(files: list[dict]) -> dict:
    priority = [f for f in files if f["path"].lower().split("/")[-1] in PRIORITY_FILES]
    selected = priority if priority else files[:3]  # ✅ Max 3 files instead of 5

    combined = ""
    for f in selected:
        combined += f"\n\n--- {f['path']} ---\n{f['content'][:1500]}"  # ✅ 1500 instead of 3000 per file

    # ✅ Hard cap on total input
    combined = combined[:4000]

    prompt = ChatPromptTemplate.from_template("""
You are a senior software architect. Analyze these repo files and give a concise summary covering:
1. What the project does
2. Tech stack used
3. Key components and their roles
4. Any issues or red flags

Be brief and technical. Reference actual file names.

Files:
{content}

Summary:
""")

    llm = get_llm()
    chain = prompt | llm | StrOutputParser()
    summary = chain.invoke({"content": combined})

    return {
        "priority_files": [f["path"] for f in priority],
        "summary": summary
    }