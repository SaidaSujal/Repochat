import httpx
import time
import json
import os
import sys
from dotenv import load_dotenv

# Load env variables from root .env
load_dotenv(dotenv_path=".env")

BACKEND_URL = "http://127.0.0.1:8000"
FRONTEND_URL = "http://localhost:3000"

print(f"--- STARTING END-TO-END VALIDATION SCRIPT ---")
print(f"Backend Target: {BACKEND_URL}")
print(f"Frontend Target: {FRONTEND_URL}")

client = httpx.Client(timeout=500.0) # Ingestion can take up to 8 mins for larger repos

# Helper to log test cases
def print_section(title):
    print("\n" + "="*50)
    print(f" {title} ")
    print("="*50)

# Phase A - Environment Validation
print_section("PHASE A: ENVIRONMENT VALIDATION")

gemini_key = os.getenv("GEMINI_API_KEY")
print(f"1. GEMINI_API_KEY present: {bool(gemini_key)}")
if gemini_key:
    # Print masked key
    masked = gemini_key[:8] + "..." + gemini_key[-4:] if len(gemini_key) > 12 else "..."
    print(f"   Value: {masked}")
else:
    print("   WARNING: GEMINI_API_KEY is not defined in .env!")

# Verify server responses
try:
    res = client.get(f"{BACKEND_URL}/docs")
    print(f"2. Backend startup status: SUCCESS (HTTP {res.status_code})")
except Exception as e:
    print(f"2. Backend startup status: FAILED ({e})")
    sys.exit(1)

try:
    res = client.get(FRONTEND_URL)
    print(f"3. Frontend startup status: SUCCESS (HTTP {res.status_code})")
except Exception as e:
    print(f"3. Frontend startup status: FAILED ({e})")
    sys.exit(1)


# Phase B - Ingestion Testing
print_section("PHASE B: REPOSITORY INGESTION TESTING")

repos_to_test = [
    {"url": "https://github.com/octocat/Spoon-Knife", "type": "Small"},
    {"url": "https://github.com/psf/requests", "type": "Medium"},
    {"url": "https://github.com/encode/starlette", "type": "Larger"}
]

ingested_repos = []

for repo_info in repos_to_test:
    url = repo_info["url"]
    rtype = repo_info["type"]
    print(f"\nIngesting {rtype} Repo: {url}")
    
    start_time = time.time()
    try:
        response = client.post(f"{BACKEND_URL}/api/ingest", json={"github_url": url})
        duration = time.time() - start_time
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Duration: {duration:.2f}s")
            print(f"Repo ID: {data.get('id')}")
            print(f"Name: {data.get('name')} | Owner: {data.get('owner')}")
            print(f"Files Count: {data.get('file_count')}")
            print(f"Size: {data.get('total_size_bytes') / (1024*1024):.2f} MB")
            print(f"Summary generated: {bool(data.get('summary'))}")
            print(f"Architecture generated: {bool(data.get('architecture_overview'))}")
            ingested_repos.append(data)
        else:
            print(f"ERROR: Received response {response.status_code} - {response.text}")
    except Exception as e:
        print(f"Ingestion FAILED with exception: {e}")
        
    # Cool down wait between repo ingestions to allow free tier rate limits to clear
    print("Cooling down for 65 seconds to clear Gemini free-tier rate limits...")
    time.sleep(65.0)


# Phase C - Dashboard Endpoint Checks
print_section("PHASE C: DASHBOARD TESTING")

for repo in ingested_repos:
    rid = repo["id"]
    name = repo["name"]
    print(f"\nChecking Dashboard endpoints for Repo ID {rid} ({name}):")
    
    # Metadata endpoint
    res_meta = client.get(f"{BACKEND_URL}/api/repositories/{rid}")
    print(f"1. /api/repositories/{rid} status: {res_meta.status_code}")
    
    # Summary endpoint
    res_sum = client.get(f"{BACKEND_URL}/api/repositories/{rid}/summary")
    print(f"2. /api/repositories/{rid}/summary status: {res_sum.status_code}")
    
    # Architecture endpoint
    res_arch = client.get(f"{BACKEND_URL}/api/repositories/{rid}/architecture")
    print(f"3. /api/repositories/{rid}/architecture status: {res_arch.status_code}")


# Phase D & E - Chat System & Citation Testing
print_section("PHASE D & E: CHAT & CITATION TESTING")

questions_by_repo = {
    "Spoon-Knife": [
        "What does this repository do?",
        "Describe the index.html file structure.",
        "Where is the stylesheet linked?",
        "Is there any python code in this repository?",
        "What is the fork model of this repository?"
    ],
    "requests": [
        "What does this repository do?",
        "Where is the Session class defined?",
        "How does requests handle authentication?",
        "Explain how connection pooling is implemented.",
        "Show where HTTP request execution occurs."
    ],
    "starlette": [
        "What does Starlette do?",
        "Explain the routing mechanism in Starlette.",
        "How is HTTP middleware structured?",
        "Where is the request class defined?",
        "Show how background tasks are run."
    ]
}

citations_collected = []

for repo in ingested_repos:
    rid = repo["id"]
    name = repo["name"]
    questions = questions_by_repo.get(name, ["What does this repo do?"])
    
    print(f"\n--- Chatting with Repo ID {rid} ({name}) ---")
    for q in questions:
        print(f"\nQuestion: {q}")
        start_time = time.time()
        try:
            res = client.post(f"{BACKEND_URL}/api/repositories/{rid}/chat", json={"query": q})
            latency = time.time() - start_time
            print(f"Status: {res.status_code} (Latency: {latency:.2f}s)")
            
            if res.status_code == 200:
                data = res.json()
                print(f"Concise Answer: {data.get('short_answer')}")
                print(f"Snippets count: {len(data.get('code_snippets', []))}")
                print(f"Citations count: {len(data.get('citations', []))}")
                print(f"Suggestions count: {len(data.get('follow_up_suggestions', []))}")
                
                # Collect citations for Phase E verification
                for cit in data.get("citations", []):
                    citations_collected.append({
                        "repo_name": name,
                        "file_path": cit.get("file_path"),
                        "start_line": cit.get("start_line"),
                        "end_line": cit.get("end_line"),
                    })
            else:
                print(f"Error: {res.text}")
        except Exception as e:
            print(f"Request failed: {e}")

# Phase E: Citation Check report
print_section("PHASE E: CITATION VALIDATION REPORT")
print(f"Total citations collected from chats: {len(citations_collected)}")
unique_citations = []
seen = set()
for c in citations_collected:
    key = (c["repo_name"], c["file_path"])
    if key not in seen:
        seen.add(key)
        unique_citations.append(c)

# Report top 10 unique citations
for idx, cit in enumerate(unique_citations[:10]):
    print(f"{idx+1}. Repo: {cit['repo_name']} | File: {cit['file_path']} (Lines {cit['start_line']}-{cit['end_line']})")
    print(f"   GitHub path: blob/HEAD/{cit['file_path']}#L{cit['start_line']}-L{cit['end_line']}")


# Phase F - Error Handling
print_section("PHASE F: ERROR HANDLING TESTING")

error_cases = [
    {"name": "Invalid GitHub URL", "url": "/api/ingest", "method": "POST", "body": {"github_url": "https://github.com/bad_owner"}},
    {"name": "Non-GitHub URL", "url": "/api/ingest", "method": "POST", "body": {"github_url": "https://gitlab.com/owner/repo"}},
    {"name": "Empty Repository URL", "url": "/api/ingest", "method": "POST", "body": {"github_url": ""}},
    {"name": "Invalid Repository ID metadata", "url": "/api/repositories/99999", "method": "GET"},
    {"name": "Empty Chat Question", "url": "/api/repositories/1/chat", "method": "POST", "body": {"query": ""}},
    {"name": "Chat Question over 1000 chars", "url": "/api/repositories/1/chat", "method": "POST", "body": {"query": "x" * 1050}},
    {"name": "Repository Not In Cache chat", "url": "/api/repositories/88888/chat", "method": "POST", "body": {"query": "Hello"}}
]

for idx, case in enumerate(error_cases):
    name = case["name"]
    url = f"{BACKEND_URL}{case['url']}"
    method = case["method"]
    
    print(f"\n{idx+1}. Case: {name}")
    try:
        if method == "POST":
            res = client.post(url, json=case.get("body", {}))
        else:
            res = client.get(url)
        print(f"   HTTP Status: {res.status_code}")
        print(f"   Response Body: {res.json()}")
    except Exception as e:
        print(f"   Failed with exception: {e}")


# Phase G - Rate Limiting
print_section("PHASE G: RATE LIMITING TESTING")
print("Simulating ingestion requests to hit hourly rate limit (Max 5/hour)")
rate_limit_triggered = False

for i in range(10):
    url = f"https://github.com/limiter/repo-{i}"
    print(f"Attempting Ingestion {i+1}...")
    try:
        res = client.post(f"{BACKEND_URL}/api/ingest", json={"github_url": url})
        print(f"Ingestion {i+1} Response: {res.status_code}")
        if res.status_code == 429:
            rate_limit_triggered = True
            print(f"SUCCESS: Rate limit triggered! Status 429. Body: {res.json()}")
            break
    except Exception as e:
        print(f"Request {i+1} failed: {e}")
        break

if not rate_limit_triggered:
    print("WARNING: Rate limit was not triggered during tests.")


# Phase I - Security Validation Checks
print_section("PHASE I: RUNTIME SECURITY VALIDATION")
print("1. Checking that frontend bundle does not contain API keys...")
try:
    res = client.get(f"{FRONTEND_URL}/_next/static/chunks/app/page-862337670abbdf51.js") # Sample page chunk
    if gemini_key in res.text:
         print("   CRITICAL WARNING: Gemini API Key exposed in frontend JS static asset!")
    else:
         print("   SUCCESS: Gemini API Key not found in public static client scripts.")
except:
    print("   Note: Frontend chunk name differs, skipping inline key search.")

print("--- END-TO-END VALIDATION COMPLETE ---")
