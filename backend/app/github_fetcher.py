import aiohttp
import os
from typing import List, Dict
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

SUPPORTED_EXTENSIONS = (".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".md", ".json", ".yaml", ".yml", ".txt")

def parse_github_url(url: str) -> tuple[str, str]:
    url = url.strip().rstrip("/").replace(".git", "")
    if not url.startswith("http"):
        url = "https://github.com/" + url
    parts = urlparse(url).path.strip("/").split("/")
    if len(parts) < 2:
        raise ValueError(f"Invalid GitHub URL: {url}")
    return parts[0], parts[1]

async def fetch_repo_files(url: str) -> List[Dict]:
    owner, repo = parse_github_url(url)
    token = os.getenv("GITHUB_TOKEN")
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3.raw",
        "X-GitHub-Api-Version": "2022-11-28"
    }

    async with aiohttp.ClientSession() as session:
        # Get default branch
        async with session.get(f"https://api.github.com/repos/{owner}/{repo}", headers=headers) as r:
            info = await r.json()
            branch = info.get("default_branch", "main")

        # Get file tree
        async with session.get(f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1", headers=headers) as r:
            tree = await r.json()

        # Filter files
        files = [f for f in tree.get("tree", []) if f["type"] == "blob" and f["path"].endswith(SUPPORTED_EXTENSIONS)]

        if not files:
            raise ValueError("No readable code files found in this repository")

        # Fetch all files concurrently
        import asyncio
        async def get_file(path):
            raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
            async with session.get(raw_url, headers=headers) as r:
                if r.status == 200:
                    return {"path": path, "content": await r.text()}
            return None

        results = await asyncio.gather(*[get_file(f["path"]) for f in files])
        return [r for r in results if r is not None]
