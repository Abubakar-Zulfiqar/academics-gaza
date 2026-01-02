import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ============================================
// SMART SUBJECT MATCHING ALGORITHM
// ============================================

// Synonym/Alias mapping for educational terms
// Each group contains terms that should be considered equivalent
const SYNONYM_GROUPS: string[][] = [
  // AI & Machine Learning
  ['ai', 'artificial intelligence', 'machine intelligence'],
  ['ml', 'machine learning', 'statistical learning'],
  ['deep learning', 'neural networks', 'dl', 'ann', 'artificial neural networks'],
  ['nlp', 'natural language processing', 'text processing', 'computational linguistics'],
  ['computer vision', 'cv', 'image processing', 'image recognition'],

  // Programming & Development
  ['programming', 'coding', 'software development', 'development'],
  ['web development', 'web dev', 'frontend', 'front-end', 'front end'],
  ['backend', 'back-end', 'back end', 'server-side', 'server side'],
  ['fullstack', 'full-stack', 'full stack'],
  ['javascript', 'js', 'ecmascript'],
  ['typescript', 'ts'],
  ['python', 'py'],
  ['react', 'reactjs', 'react.js'],
  ['vue', 'vuejs', 'vue.js'],
  ['angular', 'angularjs', 'angular.js'],
  ['node', 'nodejs', 'node.js'],

  // Data & Analytics
  ['data science', 'data analytics', 'data analysis'],
  ['database', 'db', 'databases', 'data storage'],
  ['sql', 'structured query language', 'relational database'],
  ['nosql', 'non-relational database', 'document database'],
  ['big data', 'large scale data', 'data engineering'],
  ['business intelligence', 'bi', 'data visualization'],

  // Project & Management
  ['project management', 'project planning', 'pm', 'project coordination'],
  ['product management', 'product development', 'product strategy'],
  ['agile', 'scrum', 'kanban', 'lean'],
  ['leadership', 'team management', 'team lead', 'management'],

  // Mathematics & Statistics
  ['math', 'mathematics', 'maths'],
  ['stats', 'statistics', 'statistical analysis'],
  ['calculus', 'mathematical analysis', 'differential calculus', 'integral calculus'],
  ['linear algebra', 'matrix algebra', 'vector algebra'],
  ['probability', 'probability theory', 'stochastic'],

  // Science subjects
  ['bio', 'biology', 'biological sciences', 'life sciences'],
  ['chem', 'chemistry', 'chemical sciences'],
  ['physics', 'physical sciences'],
  ['econ', 'economics', 'economic theory'],

  // Business & Finance
  ['accounting', 'bookkeeping', 'financial accounting'],
  ['finance', 'financial management', 'corporate finance'],
  ['marketing', 'digital marketing', 'market research'],
  ['entrepreneurship', 'startup', 'business development'],

  // Design
  ['ui', 'user interface', 'interface design'],
  ['ux', 'user experience', 'experience design'],
  ['ui/ux', 'uiux', 'ui ux', 'user interface design', 'user experience design'],
  ['graphic design', 'visual design', 'graphics'],

  // Writing & Communication
  ['writing', 'content writing', 'copywriting', 'technical writing'],
  ['communication', 'communications', 'public speaking'],
  ['english', 'english language', 'esl', 'efl'],

  // Research
  ['research', 'academic research', 'scientific research'],
  ['thesis', 'dissertation', 'research paper'],
  ['literature review', 'lit review', 'research review'],

  // Healthcare
  ['healthcare', 'health care', 'medical'],
  ['nursing', 'patient care', 'clinical care'],
  ['psychology', 'psych', 'mental health'],

  // Engineering
  ['engineering', 'eng', 'engr'],
  ['mechanical engineering', 'mech eng', 'mechanical'],
  ['electrical engineering', 'ee', 'electrical'],
  ['civil engineering', 'civil eng', 'civil'],
  ['software engineering', 'software eng', 'se'],
]

// Build a map for quick synonym lookup
const synonymMap = new Map<string, string[]>()
SYNONYM_GROUPS.forEach((group: any) => {
  const normalizedGroup = group.map((term: any) => term.toLowerCase().trim())
  normalizedGroup.forEach((term: any) => {
    synonymMap.set(term, normalizedGroup)
  })
})

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length
  const n = str2.length

  if (m === 0) return n
  if (n === 0) return m

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      )
    }
  }

  return dp[m][n]
}

// Calculate similarity ratio (0 to 1)
function levenshteinSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(str1, str2) / maxLen
}

// Tokenize string into meaningful words
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1)
}

// Calculate Jaccard similarity between two sets of tokens
function jaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1)
  const set2 = new Set(tokens2)

  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])

  if (union.size === 0) return 0
  return intersection.size / union.size
}

// Check if two terms are synonyms
function areSynonyms(term1: string, term2: string): boolean {
  const normalized1 = term1.toLowerCase().trim()
  const normalized2 = term2.toLowerCase().trim()

  const group1 = synonymMap.get(normalized1)
  const group2 = synonymMap.get(normalized2)

  if (group1 && group2 && group1 === group2) return true
  if (group1 && group1.includes(normalized2)) return true
  if (group2 && group2.includes(normalized1)) return true

  return false
}

// Get all synonyms for a term
function getSynonyms(term: string): string[] {
  const normalized = term.toLowerCase().trim()
  return synonymMap.get(normalized) || [normalized]
}

// Smart similarity score between two subject strings (0 to 1)
export function calculateSubjectSimilarity(subject1: string, subject2: string): number {
  const s1 = subject1.toLowerCase().trim()
  const s2 = subject2.toLowerCase().trim()

  // 1. Exact match
  if (s1 === s2) return 1.0

  // 2. Check synonym match (high confidence)
  if (areSynonyms(s1, s2)) return 0.95

  // 3. Check if any synonym of s1 matches any synonym of s2
  const synonyms1 = getSynonyms(s1)
  const synonyms2 = getSynonyms(s2)
  for (const syn1 of synonyms1) {
    for (const syn2 of synonyms2) {
      if (syn1 === syn2) return 0.95
    }
  }

  // 4. Check containment (one is substring of other)
  if (s1.includes(s2) || s2.includes(s1)) {
    const ratio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length)
    return 0.7 + (ratio * 0.2) // 0.7 to 0.9
  }

  // 5. Tokenize and check word overlap
  const tokens1 = tokenize(s1)
  const tokens2 = tokenize(s2)

  // Check if any token matches a synonym of another token
  let synonymTokenMatches = 0
  for (const t1 of tokens1) {
    for (const t2 of tokens2) {
      if (t1 === t2 || areSynonyms(t1, t2)) {
        synonymTokenMatches++
        break
      }
    }
  }

  const tokenSynonymScore = tokens1.length > 0
    ? synonymTokenMatches / tokens1.length
    : 0

  // 6. Jaccard similarity on tokens
  const jaccardScore = jaccardSimilarity(tokens1, tokens2)

  // 7. Levenshtein similarity on full strings
  const levenshteinScore = levenshteinSimilarity(s1, s2)

  // 8. Combined score with weights
  // - Token synonym matching is most important for educational terms
  // - Jaccard captures partial topic overlap
  // - Levenshtein catches typos and minor variations
  const combinedScore = (
    tokenSynonymScore * 0.5 +  // 50% weight on synonym-aware token matching
    jaccardScore * 0.3 +       // 30% weight on word overlap
    levenshteinScore * 0.2     // 20% weight on string similarity
  )

  return combinedScore
}

// Find best matching subject from a list
export function findBestSubjectMatch(
  targetSubject: string,
  candidateSubjects: string[]
): { subject: string; similarity: number } | null {
  if (candidateSubjects.length === 0) return null

  let bestMatch = { subject: '', similarity: 0 }

  for (const candidate of candidateSubjects) {
    const similarity = calculateSubjectSimilarity(targetSubject, candidate)
    if (similarity > bestMatch.similarity) {
      bestMatch = { subject: candidate, similarity }
    }
  }

  return bestMatch.similarity > 0 ? bestMatch : null
}

// Check if subjects are similar enough to be considered a match
// Threshold can be adjusted based on requirements
export function areSubjectsSimilar(
  subject1: string,
  subject2: string,
  threshold: number = 0.5
): boolean {
  return calculateSubjectSimilarity(subject1, subject2) >= threshold
}

// Calculate overall subject match score between volunteer and student topics
export function calculateSmartSubjectScore(
  volunteerSubjects: string[],
  studentTopics: string[]
): { score: number; matchedPairs: Array<{ volunteer: string; student: string; similarity: number }> } {
  if (volunteerSubjects.length === 0 || studentTopics.length === 0) {
    return { score: 0, matchedPairs: [] }
  }

  const matchedPairs: Array<{ volunteer: string; student: string; similarity: number }> = []
  const usedVolunteerSubjects = new Set<number>()

  // For each student topic, find the best matching volunteer subject
  for (const topic of studentTopics) {
    let bestMatch = { index: -1, subject: '', similarity: 0 }

    for (let i = 0; i < volunteerSubjects.length; i++) {
      if (usedVolunteerSubjects.has(i)) continue

      const similarity = calculateSubjectSimilarity(topic, volunteerSubjects[i])
      if (similarity > bestMatch.similarity && similarity >= 0.4) { // Minimum threshold
        bestMatch = { index: i, subject: volunteerSubjects[i], similarity }
      }
    }

    if (bestMatch.index >= 0) {
      usedVolunteerSubjects.add(bestMatch.index)
      matchedPairs.push({
        volunteer: bestMatch.subject,
        student: topic,
        similarity: bestMatch.similarity
      })
    }
  }

  // Calculate overall score
  // Score is based on: number of matches and quality of matches
  const matchRatio = matchedPairs.length / studentTopics.length
  const avgSimilarity = matchedPairs.length > 0
    ? matchedPairs.reduce((sum: number, p: { similarity: number }) => sum + p.similarity, 0) / matchedPairs.length
    : 0

  const score = matchRatio * avgSimilarity * 100 // 0 to 100

  return { score, matchedPairs }
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n: any) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

export function calculateMatchScore(
  volunteer: {
    causes: string[]
    fieldsOfExpertise: string[]
    subjectsQualified: string[]
    preferredLanguage: string | null
    hoursPerWeekAvailable: number | null
    currentCapacity: number
    maxCapacity: number
  },
  student: {
    cause: string
    fieldsOfStudy: string[]
    topicsNeedSupport: Array<{ keyword: string; status: string }>
    preferredLanguage: string | null
    hoursPerWeekNeeded: number | null
  }
): { score: number; reasons: string[]; matchedSubjects?: Array<{ volunteer: string; student: string; similarity: number }> } {
  // Mandatory: Volunteer must support the student's cause
  if (!volunteer.causes.includes(student.cause)) {
    return { score: 0, reasons: ['Volunteer does not support this cause'] }
  }

  // Check availability
  if (volunteer.currentCapacity >= volunteer.maxCapacity) {
    return { score: 0, reasons: ['Volunteer at max capacity'] }
  }

  // Smart field matching using similarity algorithm
  const volunteerFields = volunteer.fieldsOfExpertise
  const studentFields = student.fieldsOfStudy

  // Find similar fields using smart matching
  const fieldMatches: Array<{ volunteer: string; student: string; similarity: number }> = []
  const usedStudentFields = new Set<number>()

  for (const vField of volunteerFields) {
    let bestMatch = { index: -1, field: '', similarity: 0 }
    for (let i = 0; i < studentFields.length; i++) {
      if (usedStudentFields.has(i)) continue
      const similarity = calculateSubjectSimilarity(vField, studentFields[i])
      if (similarity > bestMatch.similarity && similarity >= 0.5) {
        bestMatch = { index: i, field: studentFields[i], similarity }
      }
    }
    if (bestMatch.index >= 0) {
      usedStudentFields.add(bestMatch.index)
      fieldMatches.push({
        volunteer: vField,
        student: bestMatch.field,
        similarity: bestMatch.similarity
      })
    }
  }

  if (fieldMatches.length === 0) {
    return { score: 0, reasons: ['No field overlap'] }
  }

  let score = 0
  const reasons: string[] = []

  // Field match (40 points) - weighted by average similarity
  const avgFieldSimilarity = fieldMatches.reduce((sum: number, m: { similarity: number }) => sum + m.similarity, 0) / fieldMatches.length
  const fieldScore = Math.round(40 * avgFieldSimilarity)
  score += fieldScore
  const matchedFieldNames = fieldMatches.map((m: { volunteer: string; student: string }) =>
    m.volunteer.toLowerCase() === m.student.toLowerCase()
      ? m.volunteer
      : `${m.student} ≈ ${m.volunteer}`
  )
  reasons.push(`Field match (${Math.round(avgFieldSimilarity * 100)}%): ${matchedFieldNames.join(', ')}`)

  // Smart Subject keyword matching (30 points)
  const volunteerSubjects = volunteer.subjectsQualified
  const studentTopics = student.topicsNeedSupport
    .filter((t: any) => t.status === 'unassigned')
    .map((t: any) => t.keyword)

  const subjectMatchResult = calculateSmartSubjectScore(volunteerSubjects, studentTopics)

  // Scale subject score from 0-100 to 0-30
  const subjectScore = Math.round(subjectMatchResult.score * 0.3)
  score += subjectScore

  if (subjectMatchResult.matchedPairs.length > 0) {
    const matchDescriptions = subjectMatchResult.matchedPairs.map((p: { volunteer: string; student: string; similarity: number }) => {
      const similarity = Math.round(p.similarity * 100)
      return p.volunteer.toLowerCase() === p.student.toLowerCase()
        ? p.volunteer
        : `${p.student} ≈ ${p.volunteer} (${similarity}%)`
    })
    reasons.push(`Subject matches: ${matchDescriptions.join(', ')}`)
  } else if (studentTopics.length > 0) {
    reasons.push('No subject matches found')
  }

  // Language match (20 points)
  if (
    volunteer.preferredLanguage &&
    student.preferredLanguage &&
    volunteer.preferredLanguage.toLowerCase() === student.preferredLanguage.toLowerCase()
  ) {
    score += 20
    reasons.push('Language match')
  }

  // Hours availability (10 points)
  if (volunteer.hoursPerWeekAvailable && student.hoursPerWeekNeeded) {
    const hoursRatio = Math.min(1, volunteer.hoursPerWeekAvailable / student.hoursPerWeekNeeded)
    score += Math.round(hoursRatio * 10)
    reasons.push(`Hours availability: ${Math.round(hoursRatio * 100)}%`)
  }

  return {
    score,
    reasons,
    matchedSubjects: subjectMatchResult.matchedPairs
  }
}

export const FIELDS_OF_STUDY = [
  // Sciences
  'Computer Science',
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Environmental Science',
  'Data Science',
  'Statistics',

  // Engineering
  'Mechanical Engineering',
  'Electrical Engineering',
  'Civil Engineering',
  'Chemical Engineering',
  'Software Engineering',
  'Biomedical Engineering',
  'Aerospace Engineering',

  // Medicine & Health
  'Medicine',
  'Nursing',
  'Pharmacy',
  'Dentistry',
  'Public Health',
  'Psychology',
  'Veterinary Medicine',

  // Business & Economics
  'Business Administration',
  'Economics',
  'Accounting',
  'Finance',
  'Marketing',
  'Management',
  'International Business',

  // Social Sciences
  'Political Science',
  'Sociology',
  'Anthropology',
  'Geography',
  'History',
  'Philosophy',

  // Arts & Humanities
  'English Literature',
  'Arabic Literature',
  'Fine Arts',
  'Music',
  'Theater',
  'Film Studies',

  // Languages
  'English',
  'Arabic',
  'French',
  'German',
  'Spanish',
  'Ukrainian',
  'Russian',

  // Education
  'Education',
  'Early Childhood Education',
  'Special Education',
  'Educational Technology',

  // Law
  'Law',
  'International Law',
  'Criminal Justice',

  // Communication
  'Journalism',
  'Mass Communication',
  'Public Relations',

  // Architecture & Design
  'Architecture',
  'Interior Design',
  'Urban Planning',
  'Graphic Design',

  // Agriculture
  'Agriculture',
  'Food Science',
  'Animal Science',
]

export const LANGUAGES = [
  'English',
  'Arabic',
  'Ukrainian',
  'Russian',
  'French',
  'German',
  'Spanish',
  'Turkish',
  'Hebrew',
  'Polish',
  'Romanian',
  'Hungarian',
]

export const CAUSES = [
  { id: 'gaza', name: 'Gaza', region: 'Palestine' },
  { id: 'ukraine', name: 'Ukraine', region: 'Ukraine' },
]
