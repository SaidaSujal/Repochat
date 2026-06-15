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
  FolderOpen,
  ShieldCheck,
  FileText,
  GitCommit,
  Sparkles,
  Brain,
  MessageSquare
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

const EXAMPLE_QUESTIONS = [
  'What does this project do?',
  'How is the repository structured?',
  'What dependencies are required?',
  'Where is authentication implemented?',
  'How does the database layer work?',
  'What files are most important?',
  'How is configuration handled?',
  'How is versioning managed?',
];

interface DemoRepo {
  name: string;
  label: string;
  description: string;
  url: string;
}

const DEMO_REPOSITORIES: DemoRepo[] = [
  {
    name: 'pypa/sampleproject',
    label: 'Python Packaging Demo',
    description: 'A tiny official sample Python project for testing package metadata, dependencies, and structure.',
    url: 'https://github.com/pypa/sampleproject',
  },
  {
    name: 'pallets/markupsafe',
    label: 'Compact Python Library',
    description: 'A small Python library useful for exploring package layout, dependency structure, and source citations.',
    url: 'https://github.com/pallets/markupsafe',
  },
  {
    name: 'pallets/click',
    label: 'Python CLI Framework',
    description: 'A clean CLI framework repository useful for testing architecture, modules, and implementation questions.',
    url: 'https://github.com/pallets/click',
  },
  {
    name: 'pytest-dev/pytest-cov',
    label: 'Testing Plugin Example',
    description: 'A focused Python plugin repository useful for exploring test configuration, package structure, and coverage tooling.',
    url: 'https://github.com/pytest-dev/pytest-cov',
  },
  {
    name: 'pypa/packaging',
    label: 'Python Packaging Utility',
    description: 'A practical Python packaging utility repository useful for dependency and versioning questions.',
    url: 'https://github.com/pypa/packaging',
  },
];

const formatIndexedTime = (dateStr: string) => {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch (e) {
    return '';
  }
};

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

  const handleQuestionClick = () => {
    const inputEl = document.getElementById('repo-url');
    if (inputEl) {
      inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        inputEl.focus();
      }, 500);
    }
  };

  const handleUseRepo = (repoUrl: string) => {
    setUrl(repoUrl);
    const inputEl = document.getElementById('repo-url');
    if (inputEl) {
      inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        inputEl.focus();
      }, 500);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 md:py-20 flex-1 flex flex-col justify-center gap-12 md:gap-14 animate-rc-fade-in">
      {/* Hero Section */}
      <div className="text-center space-y-6 animate-rc-slide-up duration-rc-slow">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-rc-foreground leading-tight max-w-3xl mx-auto">
          Chat with <span className="bg-gradient-to-r from-rc-primary via-indigo-500 to-rc-accent bg-clip-text text-transparent">Any GitHub Repository</span>
        </h1>
        <p className="text-base sm:text-lg md:text-xl text-rc-foreground-secondary max-w-2xl mx-auto leading-relaxed">
          Understand architecture, dependencies, implementation details, and code structure through AI-powered repository intelligence.
        </p>
        
        {/* Trust Badges */}
        <div className="flex flex-wrap justify-center items-center gap-x-5 gap-y-2.5 pt-2 text-xs text-rc-foreground-secondary/90">
          <div className="flex items-center gap-1.5 font-semibold bg-rc-bg-secondary/50 border border-rc-border/60 px-3 py-1 rounded-rc-pill">
            <ShieldCheck className="h-4 w-4 text-rc-success shrink-0" />
            <span>No login required</span>
          </div>
          <div className="flex items-center gap-1.5 font-semibold bg-rc-bg-secondary/50 border border-rc-border/60 px-3 py-1 rounded-rc-pill">
            <FileText className="h-4 w-4 text-rc-primary shrink-0" />
            <span>Source-cited answers</span>
          </div>
          <div className="flex items-center gap-1.5 font-semibold bg-rc-bg-secondary/50 border border-rc-border/60 px-3 py-1 rounded-rc-pill">
            <GitCommit className="h-4 w-4 text-indigo-500 shrink-0" />
            <span>Commit-anchored references</span>
          </div>
          <div className="flex items-center gap-1.5 font-semibold bg-rc-bg-secondary/50 border border-rc-border/60 px-3 py-1 rounded-rc-pill">
            <Sparkles className="h-4 w-4 text-rc-accent shrink-0" />
            <span>Free demo</span>
          </div>
        </div>
      </div>

      {/* Main Form Box with Ambient Glow */}
      <div className="relative max-w-2xl mx-auto w-full group animate-rc-slide-up duration-rc-slow [animation-delay:100ms]">
        {/* Ambient Gradient Glow */}
        <div className="absolute -inset-1.5 bg-gradient-to-r from-rc-primary/20 via-indigo-500/20 to-rc-accent/20 rounded-rc-2xl blur-xl opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200" />
        
        <div className="relative bg-rc-card border border-rc-border rounded-rc-2xl p-6 md:p-8 shadow-rc-md overflow-hidden">
          {!loading ? (
            <>
              <form onSubmit={handleIngest} className="space-y-5">
                {isBackendHealthy === false && (
                  <div className="flex items-start gap-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-500/10 p-4 rounded-rc-xl border border-amber-500/20 mb-4 animate-pulse">
                    <Clock className="h-5 w-5 shrink-0 mt-0.5 text-amber-500 animate-spin" />
                    <div className="space-y-1">
                      <p className="font-semibold">Connecting to indexing service...</p>
                      <p className="text-xs text-rc-foreground-muted leading-relaxed font-sans">
                        Note: Free-tier servers automatically spin down after inactivity. On first load, it may take up to 60 seconds to boot up. Thank you for your patience!
                      </p>
                    </div>
                  </div>
                )}
                <div className="space-y-2.5">
                  <label htmlFor="repo-url" className="block text-[11px] font-bold text-rc-foreground-muted uppercase tracking-widest">
                    GitHub Repository URL
                  </label>
                  <div className="relative rounded-rc-xl shadow-rc-xs flex items-center group/input">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-rc-foreground-muted group-focus-within/input:text-rc-primary transition-colors duration-rc-base">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                      className="block w-full pl-12 pr-28 sm:pr-36 py-4 bg-rc-bg-secondary/60 border border-rc-border rounded-rc-xl text-rc-foreground placeholder-rc-foreground-muted focus:outline-none focus:bg-rc-card focus:border-rc-primary focus:ring-4 focus:ring-rc-primary/10 transition-all text-xs sm:text-sm font-medium rc-focus-ring"
                      disabled={loading || isBackendHealthy === false}
                      aria-label="GitHub Repository URL to index"
                    />
                    <button
                      type="submit"
                      disabled={loading || isBackendHealthy === false}
                      className="group/btn absolute right-2 top-1/2 -translate-y-1/2 px-4 sm:px-6 py-2 text-xs sm:text-sm font-bold text-white bg-gradient-to-r from-rc-primary to-indigo-600 hover:from-rc-primary-hover hover:to-indigo-700 rounded-rc-lg transition-all shadow-rc-sm hover:shadow-rc-md hover:scale-[1.01] active:scale-95 disabled:from-rc-muted disabled:to-rc-muted disabled:text-rc-foreground-muted disabled:shadow-none disabled:scale-100 disabled:cursor-not-allowed flex items-center gap-1.5 focus:outline-none rc-focus-ring"
                      aria-label="Analyze and index repository"
                    >
                      <span>Analyze</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 text-sm text-rc-destructive bg-rc-destructive-muted/10 p-3.5 rounded-rc-xl border border-rc-destructive-muted/20 animate-rc-slide-down">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}
              </form>
              
              {/* Expandable Demo/Limits Info (Collapsible to be less dominant) */}
              <details className="mt-5 group border border-rc-border/50 rounded-rc-xl bg-rc-bg-secondary/40 overflow-hidden transition-all duration-rc-base">
                <summary className="flex items-center justify-between px-4 py-2.5 text-[11px] font-semibold text-rc-foreground-muted hover:text-rc-foreground cursor-pointer select-none">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5 text-rc-foreground-muted group-open:text-rc-primary transition-colors" />
                    <span>Demo environment with Gemini Free Tier API</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-rc-foreground-muted group-open:hidden">View Limits</span>
                  <span className="text-[10px] uppercase tracking-wider text-rc-foreground-muted hidden group-open:inline">Hide</span>
                </summary>
                <div className="px-4 pb-3.5 pt-1 text-[11px] text-rc-foreground-muted border-t border-rc-border/30 space-y-2 leading-relaxed">
                  <p>
                    This public deployment uses the free-tier API. To ensure optimal performance:
                  </p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Testing is recommended with small-to-medium repositories (&lt; 500 files).</li>
                    <li>API quotas may occasionally limit usage during periods of high public traffic.</li>
                    <li>For full indexing capabilities, run RepoChat locally with your own API key.</li>
                  </ul>
                </div>
              </details>
            </>
          ) : (
          /* Progressive Ingestion Display */
          <div className="space-y-6 animate-rc-slide-up">
            <div className="flex justify-between items-center pb-2 border-b border-rc-border">
              <div>
                <h2 className="text-lg md:text-xl font-extrabold text-rc-foreground flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-rc-primary animate-rc-spin-slow" />
                  <span>Analyzing Repository</span>
                </h2>
                <p className="text-xs text-rc-foreground-muted mt-0.5">Building repository intelligence profile...</p>
              </div>
              <button 
                onClick={handleCancel}
                className="text-xs font-bold text-rc-destructive hover:bg-rc-destructive-muted/20 px-3 py-1.5 rounded-rc-md bg-rc-destructive-muted/10 border border-rc-destructive-muted/20 transition-all duration-rc-base hover:scale-105 active:scale-95 focus:outline-none rc-focus-ring"
                aria-label="Cancel analysis process"
              >
                Cancel Process
              </button>
            </div>

            {/* Simulated Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-rc-primary font-bold">Progress</span>
                <span className="text-rc-foreground-secondary">{progressValue}%</span>
              </div>
              <div className="w-full bg-rc-muted h-2.5 rounded-rc-pill overflow-hidden relative">
                <div 
                  className="bg-rc-primary h-full rounded-rc-pill transition-all duration-300 ease-out bg-gradient-to-r from-blue-500 to-indigo-600"
                  style={{ width: `${progressValue}%` }}
                />
                <div className="absolute inset-0 bg-rc-shimmer animate-rc-shimmer opacity-20" />
              </div>
            </div>

            {/* Interactive Steps List */}
            <div className="space-y-3">
              {INGESTION_STEPS.map((step, idx) => {
                const isCompleted = idx < currentStepIndex;
                const isActive = idx === currentStepIndex;

                return (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-3.5 p-3.5 rounded-rc-xl border transition-all ${
                      isActive 
                        ? 'bg-rc-primary-muted/10 border-rc-primary/30 shadow-rc-xs animate-rc-pulse-glow' 
                        : isCompleted
                        ? 'bg-rc-bg-secondary/40 border-transparent opacity-85'
                        : 'border-transparent opacity-40'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5 text-rc-success" />
                      ) : isActive ? (
                        <Clock className="h-5 w-5 text-rc-primary animate-pulse" />
                      ) : (
                        <Clock className="h-5 w-5 text-rc-foreground-muted" />
                      )}
                    </div>
                    <div>
                      <h4 className={`text-sm font-bold ${
                        isActive ? 'text-rc-primary' : 'text-rc-foreground'
                      }`}>
                        {step.label}
                      </h4>
                      {isActive && (
                        <p className="text-xs text-rc-foreground-secondary mt-1 leading-relaxed animate-rc-fade-in">
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
      </div>

      {/* Example Repositories Section */}
      <div className="space-y-6 md:space-y-8 animate-rc-slide-up duration-rc-slow [animation-delay:120ms] border-t border-rc-border/40 pt-10">
        <div className="text-center space-y-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight">
            Start With a Small Repository
          </h2>
          <p className="text-sm md:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed">
            RepoChat works best for demos when you start with a lightweight public repository.
          </p>
        </div>

        {/* Guidance Notes */}
        <div className="max-w-3xl mx-auto p-4 rounded-rc-xl bg-rc-bg-secondary/40 border border-rc-border/60 text-xs text-rc-foreground-secondary space-y-3">
          <div className="flex items-center gap-2 font-bold text-rc-foreground uppercase tracking-wider text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-rc-primary animate-pulse" />
            <span>Key Guidelines</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 leading-relaxed font-normal">
            <div className="flex items-start gap-2 text-rc-foreground-secondary">
              <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
              <span>Small repositories analyze faster and are better for quick demos.</span>
            </div>
            <div className="flex items-start gap-2 text-rc-foreground-secondary">
              <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
              <span>Large repositories may hit free-tier Gemini limits during embedding or answer generation.</span>
            </div>
            <div className="flex items-start gap-2 text-rc-foreground-secondary">
              <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
              <span>Smaller codebases make summaries, architecture, citations, and chat responses easier to verify.</span>
            </div>
            <div className="flex items-start gap-2 text-rc-foreground-secondary">
              <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
              <span>After testing with a small repository, users can try larger repositories within the configured limits.</span>
            </div>
          </div>
        </div>

        {/* Demo Repos Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {DEMO_REPOSITORIES.map((repo) => (
            <div key={repo.name} className="group bg-rc-card border border-rc-border hover:border-rc-primary/40 rounded-rc-xl p-4.5 shadow-rc-xs hover:shadow-rc-sm transition-all duration-rc-base flex flex-col justify-between gap-4">
              <div className="space-y-2.5">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-rc-pill bg-rc-primary-muted/15 border border-rc-primary/20 text-rc-primary inline-block">
                  {repo.label}
                </span>
                <h4 className="font-bold text-rc-foreground text-sm break-all group-hover:text-rc-primary transition-colors">
                  {repo.name}
                </h4>
                <p className="text-xs text-rc-foreground-secondary leading-relaxed font-normal">
                  {repo.description}
                </p>
              </div>
              <button
                onClick={() => handleUseRepo(repo.url)}
                className="w-full py-1.5 text-xs font-bold text-rc-foreground-secondary hover:text-white bg-rc-bg-secondary hover:bg-rc-primary rounded-rc-lg transition-all border border-rc-border hover:border-rc-primary flex items-center justify-center gap-1.5 focus:outline-none rc-focus-ring"
              >
                <span>Use This Repo</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* How RepoChat Works Section */}
      <div className="space-y-8 md:space-y-10 animate-rc-slide-up duration-rc-slow [animation-delay:150ms]">
        <div className="text-center space-y-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight">
            How RepoChat Works
          </h2>
          <p className="text-sm md:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed">
            Transform any public GitHub repository into an AI-searchable knowledge base in three simple steps.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative">
          
          {/* Card 1 */}
          <div className="relative group bg-rc-card border border-rc-border hover:border-rc-primary/40 rounded-rc-xl p-6 shadow-rc-xs hover:shadow-rc-md transition-all duration-rc-base flex flex-col gap-4">
            {/* Desktop Connector */}
            <div className="hidden lg:flex absolute top-1/2 -right-3.5 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-rc-bg border border-rc-border items-center justify-center text-rc-foreground-muted shadow-rc-xs group-hover:border-rc-primary/30 group-hover:text-rc-primary transition-colors duration-rc-base">
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
            <div className="w-10 h-10 rounded-rc-lg bg-rc-primary-muted/20 border border-rc-primary/20 flex items-center justify-center text-rc-primary group-hover:scale-105 transition-transform duration-rc-base shrink-0">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                <path d="M9 18c-4.51 2-5-2-7-2" />
              </svg>
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground flex items-center gap-2">
                <span className="text-xs text-rc-foreground-muted bg-rc-bg-secondary px-2 py-0.5 rounded border border-rc-border font-mono">01</span>
                <span>Paste Repository URL</span>
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Add any public GitHub repository. RepoChat securely clones and analyzes the repository structure, files, and metadata.
              </p>
            </div>
          </div>

          {/* Card 2 */}
          <div className="relative group bg-rc-card border border-rc-border hover:border-indigo-500/40 rounded-rc-xl p-6 shadow-rc-xs hover:shadow-rc-md transition-all duration-rc-base flex flex-col gap-4">
            {/* Desktop Connector */}
            <div className="hidden lg:flex absolute top-1/2 -right-3.5 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-rc-bg border border-rc-border items-center justify-center text-rc-foreground-muted shadow-rc-xs group-hover:border-indigo-500/30 group-hover:text-indigo-500 transition-colors duration-rc-base">
              <ArrowRight className="w-3.5 h-3.5" />
            </div>
            <div className="w-10 h-10 rounded-rc-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 group-hover:scale-105 transition-transform duration-rc-base shrink-0">
              <Brain className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground flex items-center gap-2">
                <span className="text-xs text-rc-foreground-muted bg-rc-bg-secondary px-2 py-0.5 rounded border border-rc-border font-mono">02</span>
                <span>AI Builds Repository Intelligence</span>
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                RepoChat indexes source code, architecture, dependencies, and implementation details using semantic search and vector embeddings.
              </p>
            </div>
          </div>

          {/* Card 3 */}
          <div className="group bg-rc-card border border-rc-border hover:border-rc-accent/40 rounded-rc-xl p-6 shadow-rc-xs hover:shadow-rc-md transition-all duration-rc-base flex flex-col md:flex-row lg:flex-col gap-4 md:col-span-2 lg:col-span-1 md:items-center lg:items-start">
            <div className="w-10 h-10 rounded-rc-lg bg-rc-accent-muted/20 border border-rc-accent/20 flex items-center justify-center text-rc-accent group-hover:scale-105 transition-transform duration-rc-base shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="space-y-2 flex-1">
              <h3 className="text-base font-bold text-rc-foreground flex items-center gap-2">
                <span className="text-xs text-rc-foreground-muted bg-rc-bg-secondary px-2 py-0.5 rounded border border-rc-border font-mono">03</span>
                <span>Ask Questions & Explore</span>
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Get source-cited answers about architecture, dependencies, workflows, implementation details, and repository behavior.
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Core Features Showcase Section */}
      <div className="space-y-8 md:space-y-10 animate-rc-slide-up duration-rc-slow [animation-delay:200ms]">
        <div className="text-center space-y-3">
          <div className="inline-block">
            <span className="text-[10px] font-bold text-rc-primary dark:text-rc-primary-hover uppercase tracking-widest bg-rc-primary-muted/20 border border-rc-primary/20 px-2.5 py-1 rounded-rc-pill">
              Core Capabilities
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight pt-1">
            What RepoChat Helps You Understand
          </h2>
          <p className="text-sm md:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed">
            Explore unfamiliar codebases faster with AI-powered repository analysis and source-grounded answers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Card 1: Repository Summary */}
          <div className="group bg-rc-card border border-rc-border hover:border-rc-primary/40 rounded-rc-xl p-5 shadow-rc-xs hover:shadow-rc-md hover:-translate-y-0.5 transition-all duration-rc-base flex flex-col gap-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-primary-muted/20 border border-rc-primary/20 flex items-center justify-center text-rc-primary group-hover:scale-105 transition-transform duration-rc-base shrink-0">
              <FileCode className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Repository Summary
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Generate a clear overview of what the project does, who it is for, and how it is organized.
              </p>
            </div>
          </div>

          {/* Card 2: Architecture Analysis */}
          <div className="group bg-rc-card border border-rc-border hover:border-indigo-500/40 rounded-rc-xl p-5 shadow-rc-xs hover:shadow-rc-md hover:-translate-y-0.5 transition-all duration-rc-base flex flex-col gap-4">
            <div className="w-9 h-9 rounded-rc-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 group-hover:scale-105 transition-transform duration-rc-base shrink-0">
              <GitBranch className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Architecture Analysis
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Understand folder structure, important modules, data flow, and implementation patterns.
              </p>
            </div>
          </div>

          {/* Card 3: AI Repository Chat */}
          <div className="group bg-rc-card border border-rc-border hover:border-rc-accent/40 rounded-rc-xl p-5 shadow-rc-xs hover:shadow-rc-md hover:-translate-y-0.5 transition-all duration-rc-base flex flex-col gap-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-accent-muted/20 border border-rc-accent/20 flex items-center justify-center text-rc-accent group-hover:scale-105 transition-transform duration-rc-base shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                AI Repository Chat
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Ask questions about dependencies, files, features, configuration, and code behavior.
              </p>
            </div>
          </div>

          {/* Card 4: Source-Cited Answers */}
          <div className="group bg-rc-card border border-rc-border hover:border-rc-success/40 rounded-rc-xl p-5 shadow-rc-xs hover:shadow-rc-md hover:-translate-y-0.5 transition-all duration-rc-base flex flex-col gap-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-success-muted/20 border border-rc-success/20 flex items-center justify-center text-rc-success group-hover:scale-105 transition-transform duration-rc-base shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Source-Cited Answers
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Every answer includes file references, line ranges, snippets, and GitHub links when available.
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Example Questions Section */}
      <div className="space-y-8 md:space-y-10 animate-rc-slide-up duration-rc-slow [animation-delay:250ms]">
        <div className="text-center space-y-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight">
            Ask Practical Repository Questions
          </h2>
          <p className="text-sm md:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed">
            Use RepoChat to explore architecture, dependencies, configuration, code behavior, and implementation details.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {EXAMPLE_QUESTIONS.map((question, idx) => (
            <div 
              key={idx}
              onClick={handleQuestionClick}
              className="group bg-rc-card border border-rc-border hover:border-rc-primary/40 rounded-rc-xl p-4 shadow-rc-xs hover:shadow-rc-sm transition-all duration-rc-base flex items-center justify-between gap-3 cursor-pointer select-none"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-rc-md bg-rc-bg-secondary border border-rc-border flex items-center justify-center text-rc-foreground-muted group-hover:text-rc-primary group-hover:bg-rc-primary-muted/10 transition-colors duration-rc-base shrink-0">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <span className="text-xs sm:text-sm font-semibold text-rc-foreground-secondary group-hover:text-rc-foreground transition-colors duration-rc-base leading-snug">
                  {question}
                </span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-rc-foreground-muted opacity-0 group-hover:opacity-100 group-hover:text-rc-primary transition-all duration-rc-base -translate-x-1.5 group-hover:translate-x-0 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Why Use RepoChat Section */}
      <div className="space-y-8 md:space-y-10 animate-rc-slide-up duration-rc-slow [animation-delay:280ms]">
        <div className="text-center space-y-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight">
            Why Use RepoChat?
          </h2>
          <p className="text-sm md:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed">
            Streamline your developer onboarding and codebase exploration with a purpose-built AI assistant.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Feature 1 */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-primary-muted/20 border border-rc-primary/20 flex items-center justify-center text-rc-primary shrink-0">
              <Cpu className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Instant Comprehension
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Go from cloning to structural understanding in seconds. Bypasses manual setup, local dependency configuration, and library versions.
              </p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Context-Rich Confidence
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Every answer is grounded in the actual codebase files, providing links, line references, and code snippets to verify correctness.
              </p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-success-muted/20 border border-rc-success/20 flex items-center justify-center text-rc-success shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Local-First Privacy
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Your indexing session logs and chat history stay stored locally in your browser cache, keeping your intellectual property private.
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Built With a Modern AI Stack Section */}
      <div className="space-y-8 md:space-y-10 animate-rc-slide-up duration-rc-slow [animation-delay:300ms]">
        <div className="text-center space-y-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight">
            Built With a Modern AI Stack
          </h2>
          <p className="text-sm md:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed">
            RepoChat combines a full-stack web application, retrieval-augmented generation, vector search, and source-grounded AI responses.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          
          {/* Group 1: Frontend */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 shadow-rc-xs space-y-4">
            <h3 className="text-sm font-bold text-rc-primary dark:text-rc-primary-hover uppercase tracking-wider">
              Frontend
            </h3>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Next.js
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                React
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                TypeScript
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Tailwind CSS
              </span>
            </div>
          </div>

          {/* Group 2: Backend */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 shadow-rc-xs space-y-4">
            <h3 className="text-sm font-bold text-indigo-500 uppercase tracking-wider">
              Backend
            </h3>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                FastAPI
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Python
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                SQLAlchemy
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                SQLite
              </span>
            </div>
          </div>

          {/* Group 3: AI / Retrieval */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 shadow-rc-xs space-y-4">
            <h3 className="text-sm font-bold text-rc-accent uppercase tracking-wider">
              AI / Retrieval
            </h3>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Gemini
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Gemini Embeddings
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                ChromaDB
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                RAG Pipeline
              </span>
            </div>
          </div>

          {/* Group 4: Reliability */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 shadow-rc-xs space-y-4">
            <h3 className="text-sm font-bold text-rc-success uppercase tracking-wider">
              Reliability
            </h3>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Commit-anchored citations
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Async ingestion
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Rate limiting
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-rc-md bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                Local chat history
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* Trust & Reliability Section */}
      <div className="space-y-8 md:space-y-10 animate-rc-slide-up duration-rc-slow [animation-delay:350ms]">
        <div className="text-center space-y-3">
          <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground tracking-tight">
            Designed for Source-Grounded Answers
          </h2>
          <p className="text-sm md:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed">
            RepoChat is built to help users trust AI responses by keeping answers connected to real repository files, line ranges, and immutable commit references.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* Card 1: Source-Cited Answers */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-primary-muted/20 border border-rc-primary/20 flex items-center justify-center text-rc-primary shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Source-Cited Answers
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Every answer can include file references, line ranges, and relevant snippets.
              </p>
            </div>
          </div>

          {/* Card 2: Commit-Anchored References */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0">
              <GitCommit className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Commit-Anchored References
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Citations point to the exact commit that was analyzed, so links stay stable even if the repository changes later.
              </p>
            </div>
          </div>

          {/* Card 3: Repository Isolation */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-accent-muted/20 border border-rc-accent/20 flex items-center justify-center text-rc-accent shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Repository Isolation
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Each repository has isolated metadata, vector storage, and local chat history.
              </p>
            </div>
          </div>

          {/* Card 4: No Server-Side Chat History */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rc-success-muted/20 border border-rc-success/20 flex items-center justify-center text-rc-success shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                No Server-Side Chat History
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Chat history stays in the browser using localStorage and is not stored in SQLite or ChromaDB.
              </p>
            </div>
          </div>

          {/* Card 5: Defensive Error Handling */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Defensive Error Handling
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Quota, ingestion, and provider errors are translated into safer user-facing messages.
              </p>
            </div>
          </div>

          {/* Card 6: Async Ingestion */}
          <div className="bg-rc-card border border-rc-border rounded-rc-xl p-5 md:p-6 shadow-rc-xs space-y-4">
            <div className="w-9 h-9 rounded-rc-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-rc-foreground">
                Async Ingestion
              </h3>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                Repository analysis runs in the background with clear status tracking and recovery behavior.
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Recently Indexed Repositories Section */}
      {!loading && (
        <div className="space-y-4 animate-rc-slide-up duration-rc-slow [animation-delay:350ms] border-t border-rc-border/40 pt-10">
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-rc-foreground">
              Recently Indexed Repositories
            </h3>
            <p className="text-xs text-rc-foreground-secondary leading-relaxed">
              Continue exploring repositories you have already analyzed in this browser.
            </p>
          </div>
          
          {recentRepos.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {recentRepos.map((repo) => (
                <div
                  key={repo.id}
                  onClick={() => router.push(`/repository/${repo.id}`)}
                  className="group p-5 bg-rc-card border border-rc-border hover:border-rc-primary/60 rounded-rc-xl shadow-rc-xs hover:shadow-rc-sm transition-all duration-rc-base active:scale-[0.99] cursor-pointer flex flex-col justify-between relative focus-within:ring-2 focus-within:ring-rc-primary focus-within:outline-none"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      router.push(`/repository/${repo.id}`);
                    }
                  }}
                  role="button"
                  aria-label={`Continue exploring ${repo.owner}/${repo.name}`}
                >
                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex gap-1.5 items-center">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-rc-pill bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">
                          {repo.language || 'Codebase'}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-rc-pill ${
                          repo.status === 'COMPLETED' 
                            ? 'bg-rc-success-muted/10 border border-rc-success-muted/20 text-rc-success' 
                            : repo.status === 'FAILED'
                            ? 'bg-rc-destructive-muted/10 border border-rc-destructive-muted/20 text-rc-destructive'
                            : 'bg-amber-500/10 border border-amber-500/20 text-amber-500'
                        }`}>
                          {repo.status}
                        </span>
                      </div>
                      <button
                        onClick={(e) => removeRecentRepo(repo.id, e)}
                        className="text-[10px] font-semibold text-rc-foreground-muted hover:text-rc-destructive hover:bg-rc-destructive-muted/10 transition-all rounded px-1.5 py-0.5 focus:outline-none rc-focus-ring"
                        title="Remove from history"
                        aria-label={`Remove repository ${repo.owner}/${repo.name} from local history`}
                      >
                        Remove
                      </button>
                    </div>
                    
                    <div className="space-y-1">
                      <h4 className="font-bold text-rc-foreground text-sm break-all group-hover:text-rc-primary transition-colors">
                        {repo.owner}/{repo.name}
                      </h4>
                      {repo.created_at && (
                        <p className="text-[10px] text-rc-foreground-muted font-normal">
                          Indexed on {formatIndexedTime(repo.created_at)}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-rc-border-subtle text-[11px] text-rc-foreground-muted font-medium">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-rc-foreground-muted" />
                      <span>{repo.file_count} files</span>
                    </span>
                    
                    <button 
                      className="text-[11px] font-bold text-rc-primary group-hover:text-rc-primary-hover flex items-center gap-0.5 transition-colors focus:outline-none"
                      aria-hidden="true"
                    >
                      <span>Continue</span>
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-rc-border rounded-rc-xl p-8 text-center bg-rc-card/30">
              <FolderOpen className="h-8 w-8 text-rc-foreground-muted mx-auto mb-2 opacity-50" />
              <p className="text-xs text-rc-foreground-muted font-normal max-w-sm mx-auto">
                No indexed repositories found in this browser. Enter a public GitHub repository link above to analyze your first codebase.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
