import { RepositoryResponse } from './types';

export interface RepositorySnapshotData {
  purpose: string;
  architectureStyle: string;
  primaryLanguage: string;
  complexity: 'Beginner' | 'Intermediate' | 'Advanced';
  keyDependencies: string[];
  entryPoints: string[];
  sizeSummary: string;
  estimatedChunks: number;
}

/**
 * Clean up text content of markdown headers or HTML comments.
 */
function cleanText(text: string): string {
  return text
    .replace(/^#+\s+.*$/gm, '') // Remove headers
    .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments
    .trim();
}

/**
 * Extracts the first paragraph of a given text.
 */
function getFirstParagraph(text: string): string {
  const cleaned = cleanText(text);
  if (!cleaned) return '';
  const paragraphs = cleaned.split(/\n\s*\n/);
  // Find first paragraph that is not empty or a short header
  for (const p of paragraphs) {
    const trimP = p.trim();
    if (trimP.length > 30 && !trimP.startsWith('#') && !trimP.startsWith('-')) {
      return trimP;
    }
  }
  return cleaned.slice(0, 300) + (cleaned.length > 300 ? '...' : '');
}

/**
 * Client-side heuristic parser to generate a repository snapshot from its metadata,
 * summary, and architecture overview.
 */
export function parseRepositorySnapshot(repo: RepositoryResponse): RepositorySnapshotData {
  const summary = repo.summary || '';
  const architecture = repo.architecture_overview || '';
  const combinedText = `${summary}\n${architecture}`.toLowerCase();

  // 1. Purpose
  let purpose = getFirstParagraph(summary);
  if (!purpose) {
    purpose = `A code repository named ${repo.name} owned by ${repo.owner}, containing indexable source code files.`;
  }

  // 2. Architecture Style Heuristics
  let architectureStyle = 'Package-based';
  if (combinedText.includes('microservice') || combinedText.includes('service-oriented') || combinedText.includes('grpc') || combinedText.includes('soa')) {
    architectureStyle = 'Service-oriented';
  } else if (combinedText.includes('monolith') || combinedText.includes('monolithic')) {
    architectureStyle = 'Monolithic';
  } else if (combinedText.includes('cli') || combinedText.includes('command line') || combinedText.includes('command-line') || combinedText.includes('terminal tool')) {
    architectureStyle = 'CLI Tool';
  } else if (combinedText.includes('library') || combinedText.includes('pypi package') || combinedText.includes('npm package') || combinedText.includes('sdk') || combinedText.includes('wrapper')) {
    architectureStyle = 'Library';
  } else if (
    combinedText.includes('web app') ||
    combinedText.includes('web application') ||
    combinedText.includes('frontend') ||
    combinedText.includes('next.js') ||
    combinedText.includes('react app') ||
    combinedText.includes('django project') ||
    combinedText.includes('flask app')
  ) {
    architectureStyle = 'Web Application';
  } else if (repo.file_count > 80) {
    architectureStyle = 'Monolithic';
  } else if (repo.language?.toLowerCase() === 'python' && combinedText.includes('setup.py')) {
    architectureStyle = 'Library';
  }

  // 3. Primary Language
  const primaryLanguage = repo.language || 'Multiple';

  // 4. Complexity Heuristics
  let complexity: 'Beginner' | 'Intermediate' | 'Advanced' = 'Intermediate';
  if (repo.file_count <= 15 && repo.total_size_bytes < 150000) {
    complexity = 'Beginner';
  } else if (repo.file_count > 60 || repo.total_size_bytes > 2000000 || combinedText.includes('advanced') || combinedText.includes('complex')) {
    complexity = 'Advanced';
  }

  // 5. Key Dependencies Heuristics
  const commonDeps = [
    // JS/TS
    'react', 'next.js', 'next', 'tailwindcss', 'tailwind', 'typescript', 'prisma', 'express', 'lodash', 'redux', 'axios', 'vite', 'jest', 'shadcn',
    // Python
    'fastapi', 'flask', 'django', 'pydantic', 'sqlalchemy', 'numpy', 'pandas', 'requests', 'pytest', 'celery', 'uvicorn', 'transformers', 'torch', 'google-generativeai', 'chromadb',
    // Go
    'gin', 'gorm', 'cobra', 'viper', 'zap',
    // Rust
    'tokio', 'serde', 'axum', 'clap', 'reqwest',
    // General / DB / Devops
    'docker', 'postgresql', 'sqlite', 'mongodb', 'redis', 'mysql', 'supabase'
  ];

  const foundDeps: string[] = [];
  // Scan using whole word boundaries (approximated)
  for (const dep of commonDeps) {
    const regex = new RegExp(`\\b${dep.replace('.', '\\.')}\\b`, 'i');
    if (regex.test(combinedText)) {
      // Format nicely
      let formatted = dep;
      if (dep === 'next') formatted = 'Next.js';
      else if (dep === 'tailwindcss') formatted = 'TailwindCSS';
      else if (dep === 'fastapi') formatted = 'FastAPI';
      else if (dep === 'pydantic') formatted = 'Pydantic';
      else if (dep === 'sqlalchemy') formatted = 'SQLAlchemy';
      else if (dep === 'google-generativeai') formatted = 'Gemini API';
      else if (dep === 'chromadb') formatted = 'ChromaDB';
      else formatted = dep.charAt(0).toUpperCase() + dep.slice(1);

      if (!foundDeps.includes(formatted)) {
        foundDeps.push(formatted);
      }
    }
  }

  // Also parse markdown bullet lists under dependency/technology headings
  const depSectionRegex = /(?:dependencies|tech stack|technologies|requirements|libraries|frameworks)[\s\S]*?(\n\s*-[\s\S]*?)(?:\n\s*#|$)/i;
  const match = combinedText.match(depSectionRegex);
  if (match && match[1]) {
    const listLines = match[1].split('\n');
    for (const line of listLines) {
      const bulletMatch = line.match(/^\s*[-*+]\s+`?([\w.-]+)`?/);
      if (bulletMatch && bulletMatch[1]) {
        const item = bulletMatch[1].trim();
        // Capitalize nicely if it is short
        const formatted = item.length <= 4 ? item.toUpperCase() : item.charAt(0).toUpperCase() + item.slice(1);
        if (formatted.length > 1 && formatted.length < 20 && !foundDeps.includes(formatted) && !/^(and|the|a|for|with)$/i.test(formatted)) {
          foundDeps.push(formatted);
        }
      }
    }
  }

  const keyDependencies = foundDeps.slice(0, 5);
  if (keyDependencies.length === 0) {
    keyDependencies.push('None detected');
  }

  // 6. Entry Points Heuristics
  const entryPoints: string[] = [];
  
  // Look for common files mentioned in the text
  const fileRegex = /(?:src\/|app\/|bin\/|cli\/)?([\w-]+\.(?:py|ts|tsx|js|jsx|go|rs|cpp|h|java|cs|rb|php|sh))/gi;
  let m;
  const entryKeywords = ['main', 'app', 'index', 'cli', 'server', 'run', 'start', 'handler', 'api'];
  
  while ((m = fileRegex.exec(combinedText)) !== null) {
    const filepath = m[1].toLowerCase();
    const hasKeyword = entryKeywords.some(keyword => filepath.includes(keyword));
    if (hasKeyword && !entryPoints.includes(m[1]) && m[1].length < 30) {
      entryPoints.push(m[1]);
    }
  }

  // Deduplicate and filter out common false positives
  const filteredEntryPoints = entryPoints.filter(ep => {
    const epLower = ep.toLowerCase();
    return !epLower.includes('test') && !epLower.includes('spec') && !epLower.includes('config') && !epLower.includes('setup');
  }).slice(0, 3);

  // If no entry points found, provide intelligent defaults based on language
  if (filteredEntryPoints.length === 0) {
    const langLower = primaryLanguage.toLowerCase();
    if (langLower.includes('python')) {
      filteredEntryPoints.push('main.py');
      filteredEntryPoints.push('app.py');
    } else if (langLower.includes('typescript') || langLower.includes('javascript')) {
      filteredEntryPoints.push('src/index.ts');
      filteredEntryPoints.push('src/main.ts');
    } else if (langLower.includes('go')) {
      filteredEntryPoints.push('main.go');
    } else if (langLower.includes('rust')) {
      filteredEntryPoints.push('src/main.rs');
    } else {
      filteredEntryPoints.push('index.js');
    }
  }

  // 7. Size Summary
  const sizeInMB = repo.total_size_bytes / (1024 * 1024);
  let sizeSummary = `${sizeInMB.toFixed(2)} MB`;
  if (sizeInMB < 0.1) {
    sizeSummary = `${(repo.total_size_bytes / 1024).toFixed(1)} KB (Very Small)`;
  } else if (sizeInMB < 1.0) {
    sizeSummary = `${(repo.total_size_bytes / 1024).toFixed(0)} KB (Small)`;
  } else if (sizeInMB < 10.0) {
    sizeSummary = `${sizeInMB.toFixed(1)} MB (Medium)`;
  } else {
    sizeSummary = `${sizeInMB.toFixed(1)} MB (Large)`;
  }

  // 8. Chunks estimate (400 tokens / chunk is approx 2000 chars, so ~2KB average)
  const estimatedChunks = Math.max(repo.file_count, Math.round(repo.total_size_bytes / 2400)) + 3;

  return {
    purpose,
    architectureStyle,
    primaryLanguage,
    complexity,
    keyDependencies,
    entryPoints: filteredEntryPoints,
    sizeSummary,
    estimatedChunks
  };
}

/**
 * Generates repository-specific suggested questions.
 */
export function getSuggestedQuestions(repo: RepositoryResponse): string[] {
  const lang = (repo.language || 'javascript').toLowerCase();
  const summary = (repo.summary || '').toLowerCase();
  
  const questions: string[] = [];
  
  // 1. Primary purpose question custom to repository
  questions.push(`What is the primary purpose of ${repo.name}?`);
  
  // 2. Technical / Domain specific questions
  if (lang.includes('python')) {
    if (summary.includes('django') || summary.includes('flask') || summary.includes('fastapi') || summary.includes('web')) {
      questions.push('What are the main API routes or endpoints configured?');
      questions.push('Where is the database connectivity and model definition logic located?');
    } else {
      questions.push('How is this Python package configured and modularized?');
      questions.push('What external dependencies or setups are needed to run it?');
    }
  } else if (lang.includes('typescript') || lang.includes('javascript')) {
    if (summary.includes('next.js') || summary.includes('react') || summary.includes('vue') || summary.includes('frontend')) {
      questions.push('How is the component folder layout and routing structured?');
      questions.push('Where is client-side state management implemented?');
    } else {
      questions.push('How is the application entrypoint and package config defined?');
      questions.push('What external npm dependencies are crucial for this project?');
    }
  } else if (lang.includes('go')) {
    questions.push('How is the main entry point structured in this Go codebase?');
    questions.push('What external Go modules or dependencies are used?');
  } else if (lang.includes('rust')) {
    questions.push('What Cargo features or binary targets does this project configure?');
    questions.push('What dependencies and crates does it rely on?');
  } else {
    questions.push('What is the high-level architecture style of this repository?');
    questions.push('What are the main external libraries or tools used?');
  }
  
  // 3. Coding conventions and patterns
  questions.push('How are errors handled and logged in this project?');
  
  // Ensure we return exactly 4 unique questions
  const uniqueQuestions = Array.from(new Set(questions)).slice(0, 4);
  
  // Fallbacks if list is too short
  while (uniqueQuestions.length < 4) {
    const fallbacks = [
      'What are the entry points to start run/development?',
      'How are unit tests configured in this codebase?',
      'Can you explain the main data flows in this codebase?',
      'Where is the configuration or environment logic located?'
    ];
    for (const f of fallbacks) {
      if (!uniqueQuestions.includes(f) && uniqueQuestions.length < 4) {
        uniqueQuestions.push(f);
      }
    }
  }
  
  return uniqueQuestions;
}
