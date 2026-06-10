# Concurrent Load Validation Plan (Phase 4.3E)

This document outlines the detailed execution plan for verifying the concurrent load safety of RepoChat and details a hybrid testing strategy to handle Google Gemini API free-tier quota limitations.

---

## 1. Objectives

The primary objective of Phase 4.3E is to prove that RepoChat is production-ready for concurrent users. Specifically, it must prove:
1.  **Queue & Semaphore Correctness:** The background ingestion workers respect the concurrency limit (`MAX_CONCURRENT_INGESTIONS = 2`), safely placing additional repository requests in the `PENDING` queue and transitioning them to `PROCESSING` sequentially.
2.  **Lock Safety & Starvation Prevention:** Re-triggering or concurrent processing of repositories does not result in deadlocks, worker starvation, or permanently locked ingestion states.
3.  **SQLite Contention Safety:** The SQLite database behaves safely under concurrent writes and reads without crashing due to write locks or transactional conflicts.
4.  **ChromaDB Isolation:** High concurrent read/write query volume on ChromaDB does not result in collection cross-contamination or thread-safety errors.

---

## 2. Load Categories

We will simulate three categories of concurrent requests:

*   **Concurrent Ingestion (Write Load):** Fire 5 simultaneous ingestion requests. Verify that exactly 2 enter the `PROCESSING` state in parallel, while 3 remain `PENDING` until a slot opens.
*   **Concurrent Chat (Read Load):** Fire 20 concurrent chat query requests targeting the same and different repository collections to stress-test semantic retrieval and SQLite session isolation.
*   **Mixed Concurrency Workload:** Simultaneously trigger 3 ingestion requests and 10 chat requests to verify that background writes do not block front-facing chat reads.
*   **Isolation Verification:** Programmatically verify that concurrent data fetching from ChromaDB retrieves context chunks belonging strictly to the requested repository collection.

---

## 3. Gemini Quota Analysis & Strategy

Validation in Phase 4.3D confirmed that the Gemini free-tier key has a tight daily limit (`429 You exceeded your current quota`). Running real API calls for multi-user load testing is impossible without instant quota exhaustion. 

We propose a **hybrid validation strategy (Option B)**:

| Workload Type | API Mode | Repository Target | Justification |
| :--- | :--- | :--- | :--- |
| **Stress Ingestion Load** | **Mocked API** | Multi-file mock repository (100 files each) | Tests DB locking, queue transitions, and thread pool scaling under heavy volume without consuming API quota. |
| **Stress Chat Load** | **Mocked API** | Completed mock indexes | Tests SQLite read connection pooling and ChromaDB query performance under concurrent load. |
| **Integration E2E Concurrency** | **Real API** | `https://github.com/octocat/Spoon-Knife` (Small, 3 chunks) | Executes a live concurrent run using the real Gemini API to verify actual key rate limit retries and integration behavior. |

---

## 4. Runtime Methodology

### A. Testing Levels
*   **Level 2 (Automated Concurrency Tests):** Introduce a python concurrency test suite utilizing `pytest-asyncio` and `httpx.AsyncClient` to fire concurrent tasks against FastAPI endpoints.
*   **Level 3 (Backend Runtime Concurrency Test):** Run a dedicated concurrency stress script `scratch/concurrent_stress.py` to trigger local backend uvicorn endpoints and log transaction metrics.

### B. SQLite Concurrency Validation
Verify database integrity during concurrent load by querying:
*   Transactional errors (e.g., catching `OperationalError: database is locked`).
*   Database state correctness (ensuring all 5 concurrent repositories transition to `COMPLETED` or `FAILED` without getting stuck).

### C. ChromaDB Concurrency Validation
Ensure collection isolation under load by checking:
*   ChromaDB query latency spikes.
*   Ensuring retrieved chunk metadatas contain only the collection's respective `repo_id`.

---

## 5. Metrics Collection

The concurrency stress script will gather and print the following metrics:
1.  **Queue Queueing Delay:** Time spent in the `PENDING` status for each request.
2.  **Processing Throughput:** Time taken from ingestion start to complete status transition.
3.  **Active Connections count:** Max concurrent SQLite session locks.
4.  **Error Rates:** Percentage of requests returning `500 Internal Server Error` or database conflicts.
5.  **Status Transition Latency:** Measure time taken to move from `PENDING -> PROCESSING -> COMPLETED`.

---

## 6. Risk Assessment & Mitigations

*   **Risk 1: SQLite Lock Contention (High)**
    *   *Description:* SQLite only supports a single writer. Concurrent ingestion tasks committing to SQLite at the same time can cause a lock timeout (`database is locked`).
    *   *Mitigation:* Ensure SQLite is configured in **WAL (Write-Ahead Logging)** mode and set an explicit connection busy timeout (e.g., `sqlite+aiosqlite:///../db.sqlite3?timeout=30.0`).
*   **Risk 2: ChromaDB Thread Contention (Medium)**
    *   *Description:* Multi-threaded read queries on ChromaDB collections could experience lock contention during concurrent bulk-writes.
    *   *Mitigation:* The `VectorDBService` executes collection writes inside asynchronous thread pools (`asyncio.to_thread`) to avoid blocking the main event loop.
*   **Risk 3: Deadlocked Repository Locks (Medium)**
    *   *Description:* If an ingestion task fails mid-execution, the corresponding URL lock (`GitHubService._active_ingestions`) must be safely released; otherwise, future ingestions of that repository will block indefinitely.
    *   *Mitigation:* Enforce `try...finally` blocks in `IngestionService.process_ingestion` to guarantee lock release under all failure paths.

---

## 7. Execution Recommendation

### **Option B: Proceed with modified 4.3E execution.**

*Rationale:* A fully live concurrent load test will fail instantly due to Gemini daily quota limitations. Proceeding with a modified plan that combines **mocked API stress testing** (to verify SQLite and event-loop concurrency) and a **minimal live API concurrency test** (using tiny public repositories) guarantees a rigorous safety check without risking API blockages.

---

## REQUIRED DELIVERABLES

1.  **Files likely to be changed:**
    *   `backend/database.py`: Likely to be modified to configure SQLite WAL mode and set an increased connection busy timeout.
2.  **Files likely to be created:**
    *   `backend/tests/test_concurrency.py`: Concurrency test suite simulating concurrent ingestions and queries.
    *   `scratch/concurrent_stress.py` (marked for cleanup): Script executing Level 3 backend concurrency load testing.
    *   `concurrent_load_validation.md`: Final validation report summarizing load metrics and database locks.
3.  **Purpose of Potential Files:**
    *   *`test_concurrency.py`*: Automates concurrency checks in CI/CD.
    *   *`concurrent_stress.py`*: Measures queue delays and status transitions under concurrent stress.
4.  **Are code changes expected?**
    *   Yes, minor database configuration updates (WAL mode settings) are expected to mitigate SQLite lock risks.
5.  **Are new tests expected?**
    *   Yes, concurrency tests using mocks will be added.
6.  **Are runtime scripts expected?**
    *   Yes, a temporary concurrency load runner.
