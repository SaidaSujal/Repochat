'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, RepoChatApiError } from '@/lib/api';
import { RepositoryResponse } from '@/lib/types';
import { 
  GitBranch, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Database, 
  Cpu, 
  FileCode,
  FolderOpen
} from 'lucide-react';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/([a-zA-Z0-9-_.]+)\/([a-zA-Z0-9-_.]+)$/;

interface ProgressStep {
  label: string;
  duration: number; // in ms
  description: string;
}

const INGESTION_STEPS: ProgressStep[] = [
  { label: 'Validating Repository', duration: 3000, description: 'Verifying repository existence and limits via GitHub API...' },
  { label: 'Cloning Repository', duration: 7000, description: 'Downloading repository source files onto server sandbox...' },
  { label: 'Parsing & Chunking', duration: 8000, description: 'Extracting source files and splitting them into logical code blocks...' },
  { label: 'Generating Embeddings', duration: 10000, description: 'Computing vector representations using Gemini Embeddings...' },
  { label: 'Indexing & Summarizing', duration: 15000, description: 'Saving vectors to ChromaDB and generating code summary & architecture overview...' },
];

export default function LandingPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recentRepos, setRecentRepos] = useState<RepositoryResponse[]>([]);
  const [isBackendHealthy, setIsBackendHealthy] = useState<boolean | null>(null);
  
  // Progress states
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progressValue, setProgressValue] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Load recent repositories from localStorage
    const saved = localStorage.getItem('recent_repos');
    if (saved) {
      try {
        setRecentRepos(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse recent repos', e);
      }
    }
  }, []);

  // Cleanup controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Health check loop for cold start detection
  useEffect(() => {
    let active = true;
    let timer: NodeJS.Timeout;
    
    const check = async () => {
      try {
        const res = await api.checkHealth();
        if (res && res.status === 'healthy' && active) {
          setIsBackendHealthy(true);
        }
      } catch (err) {
        if (active) {
          setIsBackendHealthy(false);
          // Retry health check every 4 seconds until it is online
          timer = setTimeout(check, 4000);
        }
      }
    };
    
    check();
    
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Simulated progressive loader
  useEffect(() => {
    if (!loading) return;

    let stepTimer: NodeJS.Timeout;
    let progressTimer: NodeJS.Timeout;

    const updateProgress = () => {
      const step = INGESTION_STEPS[currentStepIndex];
      if (!step) return;

      setProgressValue((prev) => {
        // Calculate limit for this step to not exceed 95% until complete
        const targetMax = ((currentStepIndex + 1) / INGESTION_STEPS.length) * 100 - 5;
        if (prev < targetMax) {
          return prev + 1;
        }
        return prev;
      });

      progressTimer = setTimeout(updateProgress, step.duration / 30);
    };

    const nextStep = () => {
      setCurrentStepIndex((prevIndex) => {
        if (prevIndex < INGESTION_STEPS.length - 1) {
          stepTimer = setTimeout(nextStep, INGESTION_STEPS[prevIndex + 1].duration);
          return prevIndex + 1;
        }
        return prevIndex;
      });
    };

    // Start progress animations
    progressTimer = setTimeout(updateProgress, 100);
    stepTimer = setTimeout(nextStep, INGESTION_STEPS[0].duration);

    return () => {
      clearTimeout(stepTimer);
      clearTimeout(progressTimer);
    };
  }, [loading, currentStepIndex]);

  const validateUrl = (inputUrl: string): boolean => {
    const cleanUrl = inputUrl.trim().replace(/\/$/, '').replace(/\.git$/, '');
    return GITHUB_URL_REGEX.test(cleanUrl);
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    const cleanUrl = url.trim().replace(/\/$/, '').replace(/\.git$/, '');
    if (!validateUrl(cleanUrl)) {
      setError('Please enter a valid public GitHub repository URL, e.g. https://github.com/owner/repository');
      return;
    }

    setLoading(true);
    setCurrentStepIndex(0);
    setProgressValue(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const repo = await api.ingestRepository(cleanUrl, controller.signal);
      
      // Complete progress bar immediately
      setProgressValue(100);

      // Save to recent repos in localStorage
      const updatedRecents = [repo, ...recentRepos.filter(r => r.github_url !== repo.github_url)].slice(0, 5);
      localStorage.setItem('recent_repos', JSON.stringify(updatedRecents));
      
      // Delay navigation slightly to let user see completion
      setTimeout(() => {
        router.push(`/repository/${repo.id}`);
      }, 800);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Ingestion was cancelled.');
      } else if (err instanceof RepoChatApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred during ingestion. Please check your backend connection.');
      }
      setLoading(false);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
    }
  };

  const removeRecentRepo = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = recentRepos.filter(r => r.id !== id);
    setRecentRepos(updated);
    localStorage.setItem('recent_repos', JSON.stringify(updated));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-16 flex-1 flex flex-col justify-center">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-300 dark:to-purple-400">
          Chat with any GitHub Repo
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-zinc-400 max-w-2xl mx-auto text-balance">
          Paste a public GitHub repository link below. We will index the codebase using semantic embeddings and ChromaDB so you can ask architecture and implementation questions instantly.
        </p>
      </div>

      {/* Main Form Box */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-6 md:p-8 shadow-xl">
        {!loading ? (
          <>
            <form onSubmit={handleIngest} className="space-y-4">
            {isBackendHealthy === false && (
              <div className="flex items-start gap-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/10 p-4 rounded-xl border border-amber-200 dark:border-amber-900/30 mb-4 animate-pulse">
                <Clock className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500 animate-spin" />
                <div className="space-y-1">
                  <p className="font-semibold">Connecting to indexing service...</p>
                  <p className="text-xs text-amber-600 dark:text-zinc-400 leading-relaxed font-sans">
                    Note: Free-tier servers automatically spin down after inactivity. On first load, it may take up to 60 seconds to boot up. Thank you for your patience!
                  </p>
                </div>
              </div>
            )}
            <div>
              <label htmlFor="repo-url" className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-2">
                GitHub Repository URL
              </label>
              <div className="relative rounded-lg shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-zinc-500">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                    <path d="M9 18c-4.51 2-5-2-7-2" />
                  </svg>
                </div>
                <input
                  type="text"
                  id="repo-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/facebook/react"
                  className="block w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 rounded-xl text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all sm:text-sm"
                  disabled={loading || isBackendHealthy === false}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg border border-red-200 dark:border-red-900/40">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || isBackendHealthy === false}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 text-base font-semibold text-white bg-blue-600 dark:bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-700 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isBackendHealthy === false ? "Connecting to server..." : "Analyze & Index Codebase"}</span>
              <ArrowRight className="h-5 w-5" />
            </button>
          </form>
          
          {/* Free-Tier Environment Notice */}
          <div className="mt-6 p-4 rounded-xl bg-blue-50/30 dark:bg-zinc-950/40 border border-blue-100/50 dark:border-zinc-800/80 text-xs text-gray-600 dark:text-zinc-400 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-300">
              <Cpu className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>Demo Environment Information</span>
            </div>
            <p className="leading-relaxed">
              This public demo deployment utilizes the <strong>Gemini Free Tier API</strong>. To ensure optimal performance and avoid API rate limits:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>We recommend testing with small-to-medium repositories (e.g., &lt; 500 files, &lt; 50MB).</li>
              <li>Free-tier API quotas may occasionally become exhausted during periods of high public traffic.</li>
              <li>For heavier indexing and testing, consider running RepoChat locally with your own API key.</li>
            </ul>
          </div>
          </>
        ) : (
          /* Progressive Ingestion Display */
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800 dark:text-zinc-200">
                Analyzing Repository...
              </h2>
              <button 
                onClick={handleCancel}
                className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
              >
                Cancel Process
              </button>
            </div>

            {/* Simulated Progress Bar */}
            <div className="w-full bg-gray-150 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div 
                className="bg-blue-600 dark:bg-blue-500 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressValue}%` }}
              />
            </div>

            {/* Interactive Steps List */}
            <div className="space-y-3">
              {INGESTION_STEPS.map((step, idx) => {
                const isCompleted = idx < currentStepIndex;
                const isActive = idx === currentStepIndex;

                return (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-3 p-3 rounded-xl transition-all border ${
                      isActive 
                        ? 'bg-blue-50/50 dark:bg-blue-950/10 border-blue-200 dark:border-blue-900/40' 
                        : isCompleted
                        ? 'bg-gray-50/50 dark:bg-zinc-900/30 border-transparent opacity-85'
                        : 'border-transparent opacity-40'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : isActive ? (
                        <Clock className="h-5 w-5 text-blue-500 animate-pulse" />
                      ) : (
                        <Clock className="h-5 w-5 text-gray-400 dark:text-zinc-600" />
                      )}
                    </div>
                    <div>
                      <h4 className={`text-sm font-semibold ${
                        isActive ? 'text-blue-900 dark:text-blue-200' : 'text-gray-900 dark:text-zinc-100'
                      }`}>
                        {step.label}
                      </h4>
                      {isActive && (
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                          {step.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Previously Indexed Repositories */}
      {recentRepos.length > 0 && !loading && (
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="h-5 w-5 text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-700 dark:text-zinc-300">
              Recently Indexed Repositories
            </h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {recentRepos.map((repo) => (
              <div
                key={repo.id}
                onClick={() => router.push(`/repository/${repo.id}`)}
                className="group p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-blue-500 rounded-xl shadow-sm transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400">
                      {repo.language || 'Codebase'}
                    </span>
                    <button
                      onClick={(e) => removeRecentRepo(repo.id, e)}
                      className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                      title="Remove from history"
                    >
                      Remove
                    </button>
                  </div>
                  <h4 className="font-bold text-gray-800 dark:text-zinc-100 mt-2 text-base break-all">
                    {repo.owner}/{repo.name}
                  </h4>
                </div>
                <div className="flex gap-4 mt-3 text-xs text-gray-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Indexed
                  </span>
                  <span>{repo.file_count} files</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
