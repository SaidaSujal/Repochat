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

const PIPELINE_NODES = {
  github: {
    title: 'GitHub API Ingest',
    desc: 'Clones repository structure and indexes directory metadata securely.',
    icon: GitBranch,
  },
  parser: {
    title: 'Code Chunking',
    desc: 'Extracts classes, imports, and functions into logical document parts.',
    icon: FileCode,
  },
  embeddings: {
    title: 'Gemini Embeddings',
    desc: 'Generates 768-dimensional vectors capturing code semantics.',
    icon: Cpu,
  },
  chromadb: {
    title: 'ChromaDB Vector Store',
    desc: 'Indexes and stores embeddings for semantic similarity queries.',
    icon: Database,
  },
  gemini: {
    title: 'Gemini LLM Synthesis',
    desc: 'Generates answer text based strictly on retrieved codebase chunks.',
    icon: Brain,
  },
  citations: {
    title: 'Reference Verification',
    desc: 'Extracts source file paths and commit SHAs to guarantee trust.',
    icon: CheckCircle2,
  },
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
  const [activeNode, setActiveNode] = useState<string | null>(null);

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

  // Scroll reveal IntersectionObserver
  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '0px 0px -8% 0px',
      threshold: 0.02,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
        }
      });
    }, observerOptions);

    const elements = document.querySelectorAll('.reveal-on-scroll');
    elements.forEach((el) => observer.observe(el));

    return () => {
      elements.forEach((el) => observer.unobserve(el));
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
    <div className="flex-1 bg-[#f8fbf8] dark:bg-[#09090b] transition-colors duration-200">
      
      {/* ── SECTION 1: HERO / HOME (#home) ── */}
      <section id="home" className="relative overflow-hidden pt-12 pb-20 md:pt-16 md:pb-28 border-b border-rc-border/40 bg-[#f8fbf8] dark:bg-[#09090b]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
            
            {/* Left Column: Headlines & Form */}
            <div className="lg:col-span-7 space-y-8 reveal-on-scroll">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-rc-pill bg-rc-primary-muted/20 border border-rc-primary/25 text-rc-primary text-xs font-bold uppercase tracking-wider">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                  <span>AI Code Intelligence</span>
                </div>
                <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-rc-foreground leading-tight">
                  Chat with <span className="bg-gradient-to-r from-rc-primary via-indigo-500 to-rc-accent bg-clip-text text-transparent">Any GitHub Repository</span>
                </h1>
                <p className="text-base sm:text-lg text-rc-foreground-secondary leading-relaxed max-w-2xl font-normal">
                  Understand architecture, dependencies, implementation details, and code structures instantly through source-cited codebase search.
                </p>
              </div>

              {/* Trust Badges */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 text-xs text-rc-foreground-secondary font-medium">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-rc-card border border-rc-border rounded-rc-pill shadow-rc-xs hover-lift">
                  <ShieldCheck className="h-4 w-4 text-rc-success shrink-0" />
                  <span>No login required</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-rc-card border border-rc-border rounded-rc-pill shadow-rc-xs hover-lift">
                  <FileText className="h-4 w-4 text-rc-primary shrink-0" />
                  <span>Source-cited answers</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-rc-card border border-rc-border rounded-rc-pill shadow-rc-xs hover-lift">
                  <GitCommit className="h-4 w-4 text-indigo-500 shrink-0" />
                  <span>Commit references</span>
                </div>
              </div>

              {/* Ingestion Panel Card */}
              <div className="relative group max-w-xl">
                <div className="absolute -inset-1 bg-gradient-to-r from-rc-primary/10 via-indigo-500/10 to-rc-accent/10 rounded-rc-2xl blur-xl opacity-75 group-hover:opacity-100 transition duration-500 pointer-events-none" />
                <div className="relative rc-glass border border-rc-border rounded-rc-2xl p-6 md:p-8 shadow-rc-md overflow-hidden">
                  
                  {!loading ? (
                    <form onSubmit={handleIngest} className="space-y-5">
                      {isBackendHealthy === false && (
                        <div className="flex items-start gap-3 text-sm text-amber-700 dark:text-amber-300 bg-amber-500/10 p-4 rounded-rc-xl border border-amber-500/20 mb-2 animate-pulse">
                          <Clock className="h-5 w-5 shrink-0 mt-0.5 text-amber-500 animate-spin" />
                          <div className="space-y-1">
                            <p className="font-semibold">Connecting to indexing service...</p>
                            <p className="text-xs text-rc-foreground-muted leading-relaxed font-sans font-normal">
                              Note: Free-tier servers automatically spin down. On first load, it may take up to 60 seconds to boot up.
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2.5">
                        <label htmlFor="repo-url" className="block text-[10px] font-bold text-rc-foreground-muted uppercase tracking-widest">
                          GitHub Repository URL
                        </label>
                        <div className="relative w-full">
                          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-rc-foreground-muted transition-colors">
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
                            className="block w-full pl-12 pr-28 sm:pr-36 py-4 bg-rc-bg-secondary/30 text-rc-foreground placeholder-rc-foreground-muted border border-rc-border focus:border-rc-primary focus:outline-none rounded-rc-xl text-xs sm:text-sm font-medium shadow-rc-xs transition-colors"
                            disabled={loading}
                            aria-label="GitHub Repository URL to index"
                          />
                          <button
                            type="submit"
                            disabled={loading}
                            className="group/btn absolute right-2 top-1/2 -translate-y-1/2 px-4 sm:px-6 py-2 text-xs sm:text-sm font-bold text-white bg-gradient-to-r from-rc-primary to-indigo-600 hover:from-rc-primary-hover hover:to-indigo-700 rounded-rc-lg transition-all shadow-rc-sm hover:scale-[1.01] active:scale-95 disabled:from-rc-muted disabled:to-rc-muted disabled:text-rc-foreground-muted disabled:shadow-none disabled:scale-100 disabled:cursor-not-allowed flex items-center gap-1.5 focus:outline-none"
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
                          <span className="font-medium">{error}</span>
                        </div>
                      )}
                    </form>
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
                          className="text-xs font-bold text-rc-destructive hover:bg-rc-destructive-muted/20 px-3 py-1.5 rounded-rc-md bg-rc-destructive-muted/10 border border-rc-destructive-muted/20 transition-all duration-rc-base hover:scale-105 active:scale-95 focus:outline-none"
                          aria-label="Cancel analysis process"
                        >
                          Cancel
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
                                }}`}>
                                  {step.label}
                                </h4>
                                {isActive && (
                                  <p className="text-xs text-rc-foreground-secondary mt-1 leading-relaxed animate-rc-fade-in font-normal">
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
            </div>

            {/* Right Column: Premium Isometric Hero Graphic */}
            <div className="lg:col-span-5 w-full flex flex-col justify-center items-center reveal-on-scroll overflow-visible">
              <div className="text-center lg:text-left mb-6 space-y-1 w-full max-w-md">
                <span className="text-[10px] font-bold text-rc-accent uppercase tracking-widest bg-rc-accent-muted/20 border border-rc-accent/20 px-2.5 py-1 rounded-rc-pill">
                  RAG Pipeline Visualization
                </span>
                <h3 className="text-xl font-extrabold text-rc-foreground pt-1">Multi-Layered Code Intelligence</h3>
              </div>

              <div className="relative w-full max-w-md h-[400px] flex items-center justify-center overflow-visible bg-gradient-to-br from-rc-bg-secondary/10 to-rc-bg-tertiary/5 border border-rc-border/40 rounded-rc-2xl shadow-rc-xs">
                {/* 3D Scene Wrapper */}
                <div 
                  className="relative w-[240px] h-[240px] transform-gpu select-none"
                  style={{
                    transform: 'perspective(1000px) rotateX(55deg) rotateY(0deg) rotateZ(-45deg)',
                    transformStyle: 'preserve-3d'
                  }}
                >
                  {/* Z-Axis Connecting Lines */}
                  <div className="absolute inset-0 pointer-events-none" style={{ transformStyle: 'preserve-3d' }}>
                    {/* Line 1: Left corner */}
                    <div 
                      className="absolute w-[1.5px] bg-gradient-to-b from-indigo-500/0 via-indigo-500/50 to-indigo-500/0 border-l border-dashed border-indigo-400/40"
                      style={{
                        height: '160px',
                        transform: 'translate3d(30px, 30px, 10px) rotateY(90deg)',
                        transformOrigin: 'top left'
                      }}
                    />
                    {/* Line 2: Right corner */}
                    <div 
                      className="absolute w-[1.5px] bg-gradient-to-b from-purple-500/0 via-purple-500/50 to-purple-500/0 border-l border-dashed border-purple-400/40"
                      style={{
                        height: '160px',
                        transform: 'translate3d(210px, 70px, 10px) rotateY(90deg)',
                        transformOrigin: 'top left'
                      }}
                    />
                    {/* Line 3: Bottom corner */}
                    <div 
                      className="absolute w-[1.5px] bg-gradient-to-b from-emerald-500/0 via-emerald-500/50 to-emerald-500/0 border-l border-dashed border-emerald-400/40"
                      style={{
                        height: '160px',
                        transform: 'translate3d(110px, 210px, 10px) rotateY(90deg)',
                        transformOrigin: 'top left'
                      }}
                    />
                  </div>

                  {/* Base Layer: Cloned Codebase */}
                  <div 
                    className="absolute inset-0 bg-white/90 dark:bg-zinc-900/95 rounded-rc-xl p-4 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between shadow-rc-md animate-float-iso-1 hover-glow-primary hover:border-indigo-400/50 transition-all duration-300"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    <div className="space-y-2 font-sans">
                      <div className="flex items-center gap-1.5 border-b border-rc-border/40 pb-1.5">
                        <FolderOpen className="h-4 w-4 text-rc-primary" />
                        <span className="text-[10px] font-bold text-rc-foreground font-mono">repository-root/</span>
                      </div>
                      <div className="space-y-1.5 font-mono text-[9px] text-rc-foreground-secondary">
                        <div className="flex items-center gap-1">
                          <span className="text-rc-primary">├──</span>
                          <span className="text-rc-foreground">src/</span>
                        </div>
                        <div className="flex items-center gap-1 pl-3">
                          <span className="text-rc-primary-hover">├──</span>
                          <span>auth.ts</span>
                        </div>
                        <div className="flex items-center gap-1 pl-3">
                          <span className="text-rc-primary-hover">└──</span>
                          <span>router.ts</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-rc-primary">└──</span>
                          <span>package.json</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-[8px] font-bold text-rc-foreground-muted uppercase tracking-wider font-sans">
                      <span>Git Branch: main</span>
                      <span className="w-2 h-2 rounded-full bg-rc-success animate-pulse" />
                    </div>
                  </div>

                  {/* Middle Layer: AST & Embeddings */}
                  <div 
                    className="absolute inset-0 bg-white/90 dark:bg-zinc-900/95 rounded-rc-xl p-4 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between shadow-rc-md animate-float-iso-2 hover-glow-accent hover:border-purple-400/50 transition-all duration-300"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    <div className="space-y-2 font-sans">
                      <div className="flex items-center gap-1.5 border-b border-rc-border/40 pb-1.5">
                        <Cpu className="h-4 w-4 text-rc-accent animate-spin-slow" />
                        <span className="text-[10px] font-bold text-rc-foreground font-mono">ast-chunker-embeddings</span>
                      </div>
                      
                      {/* AST Blocks Grid */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="p-1 bg-rc-accent/5 rounded border border-rc-accent/20 text-[8px] font-mono text-rc-foreground-secondary">
                          <div className="font-bold text-rc-accent">Chunk #12</div>
                          <div className="truncate text-rc-foreground-muted">class AuthController...</div>
                        </div>
                        <div className="p-1 bg-rc-primary/5 rounded border border-rc-primary/20 text-[8px] font-mono text-rc-foreground-secondary">
                          <div className="font-bold text-rc-primary">Embedding</div>
                          <div className="truncate text-rc-foreground-muted">[0.12, -0.45, 0.89...]</div>
                        </div>
                      </div>

                      {/* Small visual connection lines */}
                      <div className="flex items-center gap-1.5 text-[8px] text-rc-foreground-muted">
                        <span className="px-1 py-0.5 rounded bg-rc-bg-secondary border border-rc-border font-semibold">ChromaDB Indexed</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[8px] font-bold text-rc-accent uppercase tracking-wider font-sans">
                      <span>768 Dimensions</span>
                      <span className="text-rc-primary">Gemini Embedding</span>
                    </div>
                  </div>

                  {/* Top Layer: Interactive Q&A Response */}
                  <div 
                    className="absolute inset-0 bg-white/90 dark:bg-zinc-900/95 rounded-rc-xl p-4 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between shadow-rc-lg animate-float-iso-3 hover-glow-indigo hover:border-blue-400/50 transition-all duration-300"
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    <div className="space-y-2 font-sans">
                      <div className="flex items-center gap-1.5 border-b border-rc-border/40 pb-1.5">
                        <Brain className="h-4 w-4 text-indigo-500" />
                        <span className="text-[10px] font-bold text-rc-foreground font-mono">gemini-query-synthesis</span>
                      </div>

                      {/* Chat Bubble Layout */}
                      <div className="space-y-1.5 text-[9px] leading-relaxed">
                        <div className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 p-1.5 rounded-rc-lg border border-indigo-500/10 font-medium">
                          Q: How is security handled?
                        </div>
                        <div className="bg-rc-bg-secondary/80 text-rc-foreground-secondary p-1.5 rounded-rc-lg border border-rc-border/50 text-[8px] font-normal">
                          A: JWT checks inside <span className="text-rc-primary font-bold">auth.ts:25</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[8px] font-bold text-indigo-500 uppercase tracking-wider font-sans">
                      <span>Source-Cited Verification</span>
                      <div className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        <span className="w-1.5 h-1.5 rounded-full bg-rc-accent" />
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── SECTION 2: HOW IT WORKS (#how-it-works) ── */}
      <section id="how-it-works" className="py-20 md:py-28 border-b border-rc-border/40 bg-[#f4f4f4] dark:bg-zinc-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-3 reveal-on-scroll">
            <span className="text-[10px] font-bold text-rc-primary uppercase tracking-widest bg-rc-primary-muted/20 border border-rc-primary/20 px-2.5 py-1 rounded-rc-pill">
              Pipeline Flow
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-rc-foreground tracking-tight">
              How RepoChat Works
            </h2>
            <p className="text-sm sm:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed font-normal">
              Convert any public GitHub repository into a semantic knowledge base in three simple steps.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative reveal-on-scroll">
            {/* Step 1 */}
            <div className="relative group rc-glass hover-lift hover-glow-primary border border-rc-border rounded-rc-xl p-6 shadow-rc-xs hover:shadow-rc-md transition-all flex flex-col gap-4">
              <div className="w-10 h-10 rounded-rc-lg bg-rc-primary-muted/20 border border-rc-primary/20 flex items-center justify-center text-rc-primary shrink-0">
                <GitBranch className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-rc-foreground flex items-center gap-2">
                  <span className="text-xs text-rc-foreground-muted bg-rc-bg-secondary px-2 py-0.5 rounded border border-rc-border font-mono">01</span>
                  <span>Connect Repository</span>
                </h3>
                <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                  Provide a public GitHub link. RepoChat clones the repository code sandboxed and maps the file tree.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative group rc-glass hover-lift hover-glow-indigo border border-rc-border rounded-rc-xl p-6 shadow-rc-xs hover:shadow-rc-md transition-all flex flex-col gap-4">
              <div className="w-10 h-10 rounded-rc-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0">
                <Brain className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-rc-foreground flex items-center gap-2">
                  <span className="text-xs text-rc-foreground-muted bg-rc-bg-secondary px-2 py-0.5 rounded border border-rc-border font-mono">02</span>
                  <span>Index & Vectorize</span>
                </h3>
                <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                  Extract source classes and modules into chunks, computing vector representations using Gemini Embeddings.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative group rc-glass hover-lift hover-glow-accent border border-rc-border rounded-rc-xl p-6 shadow-rc-xs hover:shadow-rc-md transition-all flex flex-col gap-4">
              <div className="w-10 h-10 rounded-rc-lg bg-rc-accent-muted/20 border border-rc-accent/20 flex items-center justify-center text-rc-accent shrink-0">
                <MessageSquare className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-rc-foreground flex items-center gap-2">
                  <span className="text-xs text-rc-foreground-muted bg-rc-bg-secondary px-2 py-0.5 rounded border border-rc-border font-mono">03</span>
                  <span>Source-Cited Chat</span>
                </h3>
                <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                  Ask codebase questions. Receive complete descriptions complete with exact file locations and line references.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: FEATURES (#features) ── */}
      <section id="features" className="py-20 md:py-28 border-b border-rc-border/40 bg-[#f8fbf8] dark:bg-[#09090b] reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-3 reveal-on-scroll">
            <span className="text-[10px] font-bold text-rc-accent uppercase tracking-widest bg-rc-accent-muted/20 border border-rc-accent/20 px-2.5 py-1 rounded-rc-pill">
              Capabilities
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-rc-foreground tracking-tight">
              Premium Developer Intelligence
            </h2>
            <p className="text-sm sm:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed font-normal">
              Explore complex or unfamiliar codebases in minutes using precise AI semantic retrieval.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Feature 1: Repository Summary - Large Card (col-span-2) */}
            <div className="group md:col-span-2 rc-glass hover-lift hover-glow-primary border border-rc-border rounded-rc-xl p-6 md:p-8 shadow-rc-xs transition-all flex flex-col md:flex-row gap-6 items-start reveal-on-scroll reveal-delay-50">
              <div className="w-12 h-12 rounded-rc-lg bg-rc-primary-muted/25 border border-rc-primary/20 flex items-center justify-center text-rc-primary shrink-0">
                <FileCode className="w-6 h-6 stroke-[2]" />
              </div>
              <div className="space-y-3 flex-1 text-left">
                <h3 className="text-lg font-bold text-rc-foreground">Automatic Repository Summarization</h3>
                <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                  Receive a structured README-style overview detailing exactly what the codebase does, its folder structure, external dependencies, and execution entrypoints.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">Readme generation</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">Module maps</span>
                </div>
              </div>
            </div>

            {/* Feature 2: Localized Privacy - Small Card */}
            <div className="group rc-glass hover-lift hover-glow-success border border-rc-border rounded-rc-xl p-6 shadow-rc-xs transition-all flex flex-col gap-4 text-left reveal-on-scroll reveal-delay-100">
              <div className="w-10 h-10 rounded-rc-lg bg-rc-success-muted/20 border border-rc-success/20 flex items-center justify-center text-rc-success shrink-0">
                <ShieldCheck className="w-5 h-5 stroke-[2]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-rc-foreground">Browser-Only Privacy</h3>
                <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                  Your chat logs and history remain cached locally in your browser storage. No proprietary code details are persisted on the server db.
                </p>
              </div>
            </div>

            {/* Feature 3: Commit-Anchored References - Small Card */}
            <div className="group rc-glass hover-lift hover-glow-indigo border border-rc-border rounded-rc-xl p-6 shadow-rc-xs transition-all flex flex-col gap-4 text-left reveal-on-scroll reveal-delay-150">
              <div className="w-10 h-10 rounded-rc-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0">
                <GitCommit className="w-5 h-5 stroke-[2]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-rc-foreground">Commit-Anchored Citations</h3>
                <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                  All source code references point to immutable Git commits. Links stay stable even if developers push code changes to GitHub later.
                </p>
              </div>
            </div>

            {/* Feature 4: Interactive Code Chat - Large Card (col-span-2) */}
            <div className="group md:col-span-2 rc-glass hover-lift hover-glow-accent border border-rc-border rounded-rc-xl p-6 md:p-8 shadow-rc-xs transition-all flex flex-col md:flex-row gap-6 items-start reveal-on-scroll reveal-delay-200">
              <div className="w-12 h-12 rounded-rc-lg bg-rc-accent-muted/20 border border-rc-accent/20 flex items-center justify-center text-rc-accent shrink-0">
                <MessageSquare className="w-6 h-6 stroke-[2]" />
              </div>
              <div className="space-y-3 flex-1 text-left">
                <h3 className="text-lg font-bold text-rc-foreground">Context-Aware AI Chat Assistant</h3>
                <p className="text-xs sm:text-sm text-rc-foreground-secondary leading-relaxed font-normal">
                  Ask specific implementation questions (&quot;Where is user auth handled?&quot;, &quot;How does the db transaction session pool work?&quot;). The assistant searches vector space and explains concepts with actual snippets.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">Gemini Pro API</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-rc-bg-secondary border border-rc-border text-rc-foreground-secondary">Source-grounded synthesis</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── SECTION 4: INTERACTIVE DEMO (#demo) ── */}
      <section id="demo" className="py-20 md:py-28 border-b border-rc-border/40 bg-[#f4f4f4] dark:bg-zinc-900/30 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-3 reveal-on-scroll">
            <span className="text-[10px] font-bold text-rc-success uppercase tracking-widest bg-rc-success-muted/20 border border-rc-success/20 px-2.5 py-1 rounded-rc-pill">
              Interactive Demo
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-rc-foreground tracking-tight">
              Test Drive Curated Codebases
            </h2>
            <p className="text-sm sm:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed font-normal">
              Select one of our curated public GitHub repositories below to instantly pre-fill the search tool.
            </p>
          </div>

          {/* Guideline Banner */}
          <div className="max-w-3xl mx-auto p-5 rounded-rc-xl rc-glass text-xs text-rc-foreground-secondary space-y-3 reveal-on-scroll reveal-delay-50">
            <div className="flex items-center gap-2 font-bold text-rc-foreground uppercase tracking-wider text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-rc-primary animate-pulse" />
              <span>Ingestion Guidelines</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 leading-relaxed font-normal text-left">
              <div className="flex items-start gap-2">
                <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
                <span>Small repositories (&lt; 100 files) analyze in seconds and are optimal for test chats.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
                <span>Large codebases might hit public free-tier Gemini API limitations during vectorizing.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
                <span>Supported file extensions: python (.py), javascript (.js, .jsx), typescript (.ts, .tsx), go (.go), etc.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-rc-primary font-bold mt-0.5 shrink-0">✓</span>
                <span>For large private enterprise repositories, run RepoChat locally using your own private API key.</span>
              </div>
            </div>
          </div>

          {/* Demo Repos Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {DEMO_REPOSITORIES.map((repo, idx) => {
              const delayClasses = ['reveal-delay-50', 'reveal-delay-100', 'reveal-delay-150', 'reveal-delay-200', 'reveal-delay-250'];
              const glowClasses = ['hover-glow-primary', 'hover-glow-success', 'hover-glow-indigo', 'hover-glow-accent', 'hover-glow-primary'];
              return (
                <div 
                  key={repo.name} 
                  className={`group rc-glass hover-lift ${glowClasses[idx % 5]} border border-rc-border rounded-rc-xl p-5 shadow-rc-xs transition-all flex flex-col justify-between gap-4 text-left reveal-on-scroll ${delayClasses[idx % 5]}`}
                >
                  <div className="space-y-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-rc-pill bg-rc-primary-muted/15 border border-rc-primary/20 text-rc-primary inline-block">
                      {repo.label}
                    </span>
                    <h4 className="font-bold text-rc-foreground text-sm break-all group-hover:text-rc-primary transition-colors">
                      {repo.name}
                    </h4>
                    <p className="text-[11px] text-rc-foreground-secondary leading-relaxed font-normal">
                      {repo.description}
                    </p>
                  </div>
                  <button
                    onClick={() => handleUseRepo(repo.url)}
                    className="w-full py-2 text-xs font-bold text-rc-foreground-secondary hover:text-white bg-rc-bg-secondary hover:bg-rc-primary rounded-rc-lg transition-all border border-rc-border hover:border-rc-primary flex items-center justify-center gap-1.5 focus:outline-none"
                  >
                    <span>Use Repo</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Practical Questions Grid */}
          <div className="space-y-6 pt-6">
            <h3 className="text-center font-bold text-rc-foreground text-lg reveal-on-scroll">Example Inquiries to Try</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {EXAMPLE_QUESTIONS.map((question, idx) => {
                const delayClasses = ['reveal-delay-50', 'reveal-delay-100', 'reveal-delay-150', 'reveal-delay-200'];
                return (
                  <div 
                    key={idx}
                    onClick={handleQuestionClick}
                    className={`group rc-glass hover-lift hover-glow-primary border border-rc-border rounded-rc-xl p-4 shadow-rc-xs hover:shadow-rc-sm transition-all flex items-center justify-between gap-3 cursor-pointer select-none reveal-on-scroll ${delayClasses[idx % 4]}`}
                  >
                    <div className="flex items-center gap-2.5 text-left">
                      <div className="w-7 h-7 rounded-rc-md bg-rc-bg-secondary border border-rc-border flex items-center justify-center text-rc-foreground-muted group-hover:text-rc-primary group-hover:bg-rc-primary-muted/10 transition-colors shrink-0">
                        <MessageSquare className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-semibold text-rc-foreground-secondary group-hover:text-rc-foreground transition-colors leading-snug">
                        {question}
                      </span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-rc-foreground-muted opacity-0 group-hover:opacity-100 group-hover:text-rc-primary transition-all -translate-x-1.5 group-hover:translate-x-0 shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: ARCHITECTURE (#architecture) ── */}
      <section id="architecture" className="py-20 md:py-28 border-b border-rc-border/40 bg-[#f8fbf8] dark:bg-[#09090b] reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-3 reveal-on-scroll">
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-rc-pill">
              Design Blueprint
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-rc-foreground tracking-tight">
              RAG Ingestion & Query Pipeline
            </h2>
            <p className="text-sm sm:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed font-normal">
              RepoChat coordinates frontend requests, sandboxed background workers, vector search indexes, and Gemini synthesis.
            </p>
          </div>

          <div className="rc-glass hover-lift hover-glow-indigo border border-rc-border rounded-rc-2xl p-6 md:p-8 max-w-4xl mx-auto shadow-rc-md space-y-8 reveal-on-scroll reveal-delay-50">
            {/* Visual flow chart for architecture */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-center relative">
              {/* Box 1 */}
              <div className="p-5 rc-glass hover-lift hover-glow-primary border border-rc-border rounded-rc-xl flex flex-col items-center gap-3 relative reveal-on-scroll reveal-delay-100">
                <div className="w-8 h-8 rounded-full bg-rc-primary text-white flex items-center justify-center text-xs font-bold font-mono">1</div>
                <h4 className="font-bold text-rc-foreground text-sm">Cloning & Parsing</h4>
                <p className="text-[11px] text-rc-foreground-secondary leading-normal font-normal">
                  Worker clones public repo source tree and uses AST parsers to split files into document chunks.
                </p>
              </div>

              {/* Box 2 */}
              <div className="p-5 rc-glass hover-lift hover-glow-accent border border-rc-border rounded-rc-xl flex flex-col items-center gap-3 relative reveal-on-scroll reveal-delay-150">
                <div className="w-8 h-8 rounded-full bg-rc-accent text-white flex items-center justify-center text-xs font-bold font-mono">2</div>
                <h4 className="font-bold text-rc-foreground text-sm">Vector Embedding</h4>
                <p className="text-[11px] text-rc-foreground-secondary leading-normal font-normal">
                  Code segments are translated into dense vector points via the Gemini Embeddings API.
                </p>
              </div>

              {/* Box 3 */}
              <div className="p-5 rc-glass hover-lift hover-glow-indigo border border-rc-border rounded-rc-xl flex flex-col items-center gap-3 relative reveal-on-scroll reveal-delay-200">
                <div className="w-8 h-8 rounded-full bg-pink-500 text-white flex items-center justify-center text-xs font-bold font-mono">3</div>
                <h4 className="font-bold text-rc-foreground text-sm">Semantic Indexing</h4>
                <p className="text-[11px] text-rc-foreground-secondary leading-normal font-normal">
                  Embeddings and file tree metadata are indexed into an isolated local ChromaDB collection.
                </p>
              </div>

              {/* Box 4 */}
              <div className="p-5 rc-glass hover-lift hover-glow-success border border-rc-border rounded-rc-xl flex flex-col items-center gap-3 relative reveal-on-scroll reveal-delay-250">
                <div className="w-8 h-8 rounded-full bg-rc-success text-white flex items-center justify-center text-xs font-bold font-mono">4</div>
                <h4 className="font-bold text-rc-foreground text-sm">RAG Query Chat</h4>
                <p className="text-[11px] text-rc-foreground-secondary leading-normal font-normal">
                  Gemini LLM synthesizes code responses by context-matching the user question against retrieved vector chunks.
                </p>
              </div>
            </div>

            <div className="border-t border-rc-border pt-6 leading-relaxed text-xs text-rc-foreground-secondary max-w-2xl mx-auto text-center font-normal">
              <span className="font-bold text-rc-foreground">System Isolation Promise: </span>
              Each repository ingestion creates a distinct SQLite record and ChromaDB collection. Your workspace remains entirely isolated, with chat histories stored on your browser client.
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 6: TECH STACK (#tech) ── */}
      <section id="tech" className="py-20 md:py-28 border-b border-rc-border/40 bg-[#f4f4f4] dark:bg-zinc-900/30 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-3 reveal-on-scroll">
            <span className="text-[10px] font-bold text-rc-primary uppercase tracking-widest bg-rc-primary-muted/20 border border-rc-primary/20 px-2.5 py-1 rounded-rc-pill">
              Technologies
            </span>
            <h2 className="text-3xl md:text-4xl font-extrabold text-rc-foreground tracking-tight">
              Built on a State-of-the-Art AI Stack
            </h2>
            <p className="text-sm sm:text-base text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed font-normal">
              RepoChat utilizes modern full-stack web architectures to deliver instant AI code search and analysis.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            
            {/* Frontend */}
            <div className="rc-glass hover-lift hover-glow-primary border border-rc-border rounded-rc-xl p-6 shadow-rc-xs space-y-4 transition-all text-left reveal-on-scroll reveal-delay-50">
              <h3 className="text-xs font-bold text-rc-primary uppercase tracking-wider">Frontend Interface</h3>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Next.js 14</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">React 18</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">TypeScript</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Tailwind CSS</span>
              </div>
            </div>

            {/* Backend */}
            <div className="rc-glass hover-lift hover-glow-indigo border border-rc-border rounded-rc-xl p-6 shadow-rc-xs space-y-4 transition-all text-left reveal-on-scroll reveal-delay-100">
              <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-wider">Backend Service</h3>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">FastAPI</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Python 3.11</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">SQLAlchemy</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">SQLite3</span>
              </div>
            </div>

            {/* AI Core */}
            <div className="rc-glass hover-lift hover-glow-accent border border-rc-border rounded-rc-xl p-6 shadow-rc-xs space-y-4 transition-all text-left reveal-on-scroll reveal-delay-150">
              <h3 className="text-xs font-bold text-rc-accent uppercase tracking-wider">AI & Retrieval</h3>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Gemini Pro</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Gemini Embeddings</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">ChromaDB</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">RAG Pipeline</span>
              </div>
            </div>

            {/* Design & UX */}
            <div className="rc-glass hover-lift hover-glow-success border border-rc-border rounded-rc-xl p-6 shadow-rc-xs space-y-4 transition-all text-left reveal-on-scroll reveal-delay-200">
              <h3 className="text-xs font-bold text-rc-success uppercase tracking-wider">UX & Infrastructure</h3>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Lucide Icons</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">CSS Variables</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Async Workers</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-rc-bg-secondary/40 border border-rc-border text-rc-foreground-secondary">Rate Limiting</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── SECTION 7: LIMITS & FREE TIER (#limits) ── */}
      <section id="limits" className="py-20 md:py-28 bg-[#f8fbf8] dark:bg-[#09090b] border-b border-rc-border/40 reveal-on-scroll">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="bg-gradient-to-br from-rc-card via-rc-card to-rc-bg-secondary/40 dark:from-rc-card dark:to-rc-bg-secondary/10 border border-rc-border/60 rounded-rc-2xl p-8 shadow-rc-lg relative overflow-hidden text-center space-y-6 reveal-on-scroll reveal-delay-50 hover-glow-primary hover-lift">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-rc-primary via-indigo-500 to-rc-accent" />
            
            {/* Stripe-style ambient background glows */}
            <div className="absolute -top-20 -left-20 w-56 h-56 rounded-full bg-rc-primary/10 dark:bg-rc-primary/5 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -right-20 w-56 h-56 rounded-full bg-rc-accent/10 dark:bg-rc-accent/5 blur-3xl pointer-events-none" />

            <div className="w-12 h-12 rounded-full bg-rc-primary-muted/20 border border-rc-primary/20 flex items-center justify-center text-rc-primary mx-auto relative z-10">
              <Cpu className="h-6 w-6 stroke-[2]" />
            </div>

            <div className="space-y-2.5 relative z-10">
              <h2 className="text-2xl md:text-3xl font-extrabold text-rc-foreground">Gemini Free-Tier Environment Limits</h2>
              <p className="text-xs sm:text-sm text-rc-foreground-secondary max-w-xl mx-auto leading-relaxed font-normal">
                This public deployment utilizes Google&apos;s free-tier Gemini endpoints. Please take note of the following runtime constraints to ensure smooth operations:
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left pt-2 relative z-10">
              <div className="p-5 rc-glass hover-lift hover-glow-primary rounded-rc-xl space-y-1 reveal-on-scroll reveal-delay-100">
                <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Repository Size</span>
                <span className="font-extrabold text-rc-foreground text-sm block">Under 500 files</span>
                <span className="text-[11px] text-rc-foreground-secondary leading-normal block font-normal">Recommended to prevent token budget exhaustions.</span>
              </div>

              <div className="p-5 rc-glass hover-lift hover-glow-indigo rounded-rc-xl space-y-1 reveal-on-scroll reveal-delay-150">
                <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">API Quota limits</span>
                <span className="font-extrabold text-rc-foreground text-sm block">Shared Free Tier</span>
                <span className="text-[11px] text-rc-foreground-secondary leading-normal block font-normal">Heavy concurrent user traffic may cause transient 429 quota retries.</span>
              </div>

              <div className="p-5 rc-glass hover-lift hover-glow-accent rounded-rc-xl space-y-1 reveal-on-scroll reveal-delay-200">
                <span className="text-[10px] font-bold text-rc-foreground-muted uppercase tracking-wider block">Hourly limit</span>
                <span className="font-extrabold text-rc-foreground text-sm block">60 Queries / hour</span>
                <span className="text-[11px] text-rc-foreground-secondary leading-normal block font-normal">Protects resources from bot abuse or scraping queries.</span>
              </div>
            </div>

            <div className="pt-4 border-t border-rc-border relative z-10">
              <p className="text-xs text-rc-foreground-muted font-normal leading-relaxed">
                Need unlimited requests or analyzing massive code repositories? Run RepoChat locally in your terminal. Follow the startup guide in our GitHub repository to connect your private Google Gemini API key.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 8: RECENTLY INDEXED REPOSITORIES (History) ── */}
      {!loading && (
        <section className="py-20 md:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 bg-[#f4f4f4] dark:bg-zinc-900/30 border-t border-rc-border/40 reveal-on-scroll">
          <div className="space-y-1.5 text-left reveal-on-scroll">
            <h3 className="text-xl font-bold text-rc-foreground">
              Recently Indexed Repositories
            </h3>
            <p className="text-xs text-rc-foreground-secondary leading-relaxed font-normal">
              Continue exploring repositories you have already analyzed in this browser.
            </p>
          </div>
          
          {recentRepos.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 reveal-on-scroll reveal-delay-100">
              {recentRepos.map((repo, idx) => {
                const delayClasses = ['reveal-delay-50', 'reveal-delay-100', 'reveal-delay-150', 'reveal-delay-200', 'reveal-delay-250'];
                return (
                  <div
                    key={repo.id}
                    onClick={() => router.push(`/repository/${repo.id}`)}
                    className={`group p-5 rc-glass hover-lift hover-glow-indigo border border-rc-border rounded-rc-xl shadow-rc-xs hover:shadow-rc-sm transition-all active:scale-[0.99] cursor-pointer flex flex-col justify-between relative focus-within:ring-2 focus-within:ring-rc-primary focus-within:outline-none reveal-on-scroll ${delayClasses[idx % 5]}`}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        router.push(`/repository/${repo.id}`);
                      }
                    }}
                    role="button"
                    aria-label={`Continue exploring ${repo.owner}/${repo.name}`}
                  >
                    <div className="space-y-3 text-left">
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
                          className="text-[10px] font-semibold text-rc-foreground-muted hover:text-rc-destructive hover:bg-rc-destructive-muted/10 transition-all rounded px-1.5 py-0.5 focus:outline-none"
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
                    
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-rc-border/60 text-[11px] text-rc-foreground-muted font-medium">
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
                );
              })}
            </div>
          ) : (
            <div className="border border-dashed border-rc-border rounded-rc-xl p-8 text-center bg-rc-card/30 reveal-on-scroll reveal-delay-100">
              <FolderOpen className="h-8 w-8 text-rc-foreground-muted mx-auto mb-2 opacity-50" />
              <p className="text-xs text-rc-foreground-muted font-normal max-w-sm mx-auto">
                No indexed repositories found in this browser. Enter a public GitHub repository link above to analyze your first codebase.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
