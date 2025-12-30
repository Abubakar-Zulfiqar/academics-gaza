/**
 * LLM-based Subject Matching Service
 * Uses a local Ollama LLM for semantic subject matching
 * Returns JSON responses for matching subjects
 */

// Ollama API configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b'

interface SubjectMatchResult {
  isMatch: boolean
  confidence: number // 0-100
  reason: string
  volunteerSubject: string
  studentSubject: string
}

interface SubjectMatchResponse {
  matches: SubjectMatchResult[]
  hasAnyMatch: boolean
  bestMatch: SubjectMatchResult | null
}

interface LLMResponse {
  model: string
  response: string
  done: boolean
}

/**
 * Check if Ollama is running and accessible
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Query the local LLM with a prompt
 */
async function queryLLM(prompt: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for consistent, deterministic responses
          num_predict: 500, // Limit response length
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`)
    }

    const data: LLMResponse = await response.json()
    return data.response
  } catch (error) {
    console.error('LLM query failed:', error)
    throw error
  }
}

/**
 * Extract JSON from LLM response (handles markdown code blocks)
 */
function extractJSON(text: string): string {
  // Try to find JSON in markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  // Try to find raw JSON object or array
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (jsonMatch) {
    return jsonMatch[0]
  }

  return text.trim()
}

/**
 * Match a single student subject against volunteer subjects using LLM
 */
export async function matchSubjectWithLLM(
  studentSubject: string,
  volunteerSubjects: string[]
): Promise<SubjectMatchResult[]> {
  if (volunteerSubjects.length === 0) {
    return []
  }

  const prompt = `You are a subject matching assistant. Your task is to determine if a student's subject matches any volunteer's teaching subjects.

Student needs help with: "${studentSubject}"

Volunteer can teach: ${volunteerSubjects.map((s: any, i: any) => `${i + 1}. "${s}"`).join(', ')}

Rules for matching:
- "AI" matches "Artificial Intelligence" (abbreviation)
- "Machine Learning" matches "ML" or "Data Science" (related concepts)
- "Project Planning" matches "Project Management" (similar concepts)
- If volunteer lists "Computer Science" or "Any CS subject", match ANY computer science related topic
- If volunteer lists "Mathematics" or "Any Math subject", match ANY math related topic
- Be generous with partial matches for related subjects

Respond ONLY with a JSON array. Each object must have:
- "volunteerSubject": the volunteer's subject being compared
- "isMatch": true/false
- "confidence": 0-100 (how confident the match is)
- "reason": brief explanation

Example response:
[{"volunteerSubject": "Artificial Intelligence", "isMatch": true, "confidence": 95, "reason": "AI is an abbreviation for Artificial Intelligence"}]

JSON response:`

  try {
    const response = await queryLLM(prompt)
    const jsonStr = extractJSON(response)
    const results = JSON.parse(jsonStr) as Array<{
      volunteerSubject: string
      isMatch: boolean
      confidence: number
      reason: string
    }>

    return results.map((r: any) => ({
      ...r,
      studentSubject,
    }))
  } catch (error) {
    console.error('Failed to parse LLM response for subject matching:', error)
    // Fallback to basic string matching
    return volunteerSubjects.map((vs: any) => ({
      volunteerSubject: vs,
      studentSubject,
      isMatch:
        vs.toLowerCase().includes(studentSubject.toLowerCase()) ||
        studentSubject.toLowerCase().includes(vs.toLowerCase()),
      confidence: 50,
      reason: 'Fallback: basic string match',
    }))
  }
}

/**
 * Match all student subjects against all volunteer subjects
 * Returns comprehensive matching results with JSON response
 */
export async function matchAllSubjectsWithLLM(
  studentSubjects: string[],
  volunteerSubjects: string[]
): Promise<SubjectMatchResponse> {
  if (studentSubjects.length === 0 || volunteerSubjects.length === 0) {
    return {
      matches: [],
      hasAnyMatch: false,
      bestMatch: null,
    }
  }

  const allMatches: SubjectMatchResult[] = []

  // Process each student subject
  for (const studentSubject of studentSubjects) {
    const results = await matchSubjectWithLLM(studentSubject, volunteerSubjects)
    allMatches.push(...results.filter((r: any) => r.isMatch))
  }

  // Sort by confidence
  allMatches.sort((a: any, b: any) => b.confidence - a.confidence)

  return {
    matches: allMatches,
    hasAnyMatch: allMatches.length > 0,
    bestMatch: allMatches.length > 0 ? allMatches[0] : null,
  }
}

/**
 * Batch match for efficiency - matches multiple student subjects at once
 */
export async function batchMatchSubjectsWithLLM(
  studentSubjects: string[],
  volunteerSubjects: string[]
): Promise<SubjectMatchResponse> {
  if (studentSubjects.length === 0 || volunteerSubjects.length === 0) {
    return {
      matches: [],
      hasAnyMatch: false,
      bestMatch: null,
    }
  }

  const prompt = `You are a subject matching assistant. Match student subjects with volunteer teaching subjects.

Student needs help with: ${studentSubjects.map((s: any) => `"${s}"`).join(', ')}

Volunteer can teach: ${volunteerSubjects.map((s: any) => `"${s}"`).join(', ')}

Rules:
- Abbreviations match (AI = Artificial Intelligence, ML = Machine Learning)
- Related concepts match (Project Planning ≈ Project Management)
- Broader categories include specifics (Computer Science includes Python, Algorithms, etc.)
- "Any CS subject" or "Computer Science" matches any CS-related topic
- "Any Math subject" or "Mathematics" matches any math topic

Return ONLY a JSON array of matches found. Each match:
{
  "studentSubject": "student's subject",
  "volunteerSubject": "matching volunteer subject",
  "isMatch": true,
  "confidence": 0-100,
  "reason": "brief explanation"
}

If no matches, return empty array: []

JSON response:`

  try {
    const response = await queryLLM(prompt)
    const jsonStr = extractJSON(response)
    const results = JSON.parse(jsonStr) as SubjectMatchResult[]

    const validMatches = results.filter((r: any) => r.isMatch)
    validMatches.sort((a: any, b: any) => b.confidence - a.confidence)

    return {
      matches: validMatches,
      hasAnyMatch: validMatches.length > 0,
      bestMatch: validMatches.length > 0 ? validMatches[0] : null,
    }
  } catch (error) {
    console.error('Batch LLM matching failed, falling back to individual matching:', error)
    // Fallback to individual matching
    return matchAllSubjectsWithLLM(studentSubjects, volunteerSubjects)
  }
}

// ============================================
// HARD-CODED FILTERS (Cause and Field matching)
// ============================================

/**
 * Hard-coded cause matching - exact match required
 */
export function matchCause(volunteerCauses: string[], studentCause: string): boolean {
  // Normalize student cause for comparison
  const sCause = studentCause.toLowerCase().trim()

  // Handle common variations
  const causeAliases: Record<string, string[]> = {
    education: ['education', 'educational', 'academic'],
    refugee: ['refugee', 'refugees', 'refugee support'],
    immigration: ['immigration', 'immigrant', 'immigrants'],
    youth: ['youth', 'young people', 'children'],
    poverty: ['poverty', 'low income', 'disadvantaged'],
  }

  // Check if any volunteer cause matches
  for (const volunteerCause of volunteerCauses) {
    const vCause = volunteerCause.toLowerCase().trim()

    // Exact match
    if (vCause === sCause) return true

    // Check cause aliases
    for (const [, aliases] of Object.entries(causeAliases)) {
      if (aliases.includes(vCause) && aliases.includes(sCause)) {
        return true
      }
    }
  }

  return false
}

/**
 * Hard-coded field matching - checks if fields overlap
 */
export function matchFields(
  volunteerFields: string[],
  studentFields: string[]
): {
  isMatch: boolean
  matchedFields: string[]
} {
  const vFields = volunteerFields.map((f: any) => f.toLowerCase().trim())
  const sFields = studentFields.map((f: any) => f.toLowerCase().trim())

  const matchedFields: string[] = []

  // Define field categories and their variations
  const fieldCategories: Record<string, string[]> = {
    'computer science': [
      'computer science',
      'cs',
      'computing',
      'software engineering',
      'software development',
      'information technology',
      'it',
      'programming',
    ],
    mathematics: [
      'mathematics',
      'math',
      'maths',
      'applied mathematics',
      'pure mathematics',
      'statistics',
    ],
    physics: ['physics', 'applied physics', 'theoretical physics'],
    chemistry: ['chemistry', 'organic chemistry', 'inorganic chemistry', 'biochemistry'],
    biology: ['biology', 'life sciences', 'biological sciences', 'microbiology'],
    engineering: [
      'engineering',
      'mechanical engineering',
      'electrical engineering',
      'civil engineering',
      'chemical engineering',
    ],
    business: [
      'business',
      'business administration',
      'management',
      'marketing',
      'finance',
      'accounting',
      'economics',
    ],
    medicine: ['medicine', 'medical', 'healthcare', 'nursing', 'pre-med'],
    law: ['law', 'legal studies', 'pre-law'],
    arts: ['arts', 'fine arts', 'visual arts', 'art history'],
    humanities: ['humanities', 'literature', 'english', 'history', 'philosophy'],
    languages: ['languages', 'linguistics', 'foreign languages', 'english language'],
    psychology: ['psychology', 'behavioral science', 'cognitive science'],
    social_sciences: ['social sciences', 'sociology', 'anthropology', 'political science'],
    education: ['education', 'teaching', 'pedagogy'],
  }

  for (const vField of vFields) {
    for (const sField of sFields) {
      // Direct match
      if (vField === sField) {
        matchedFields.push(sField)
        continue
      }

      // Check if both belong to same category
      for (const [category, variations] of Object.entries(fieldCategories)) {
        const vInCategory = variations.some(
          (v: any) => vField.includes(v) || v.includes(vField)
        )
        const sInCategory = variations.some(
          (v: any) => sField.includes(v) || v.includes(sField)
        )

        if (vInCategory && sInCategory && !matchedFields.includes(category)) {
          matchedFields.push(category)
        }
      }
    }
  }

  return {
    isMatch: matchedFields.length > 0,
    matchedFields,
  }
}

// ============================================
// COMBINED MATCHING FUNCTION
// ============================================

export interface FullMatchResult {
  isMatch: boolean
  score: number // 0-100
  causeMatch: boolean
  fieldMatch: {
    isMatch: boolean
    matchedFields: string[]
  }
  subjectMatch: SubjectMatchResponse
  reasons: string[]
}

/**
 * Full matching function combining:
 * - Hard-coded cause matching (mandatory filter)
 * - Hard-coded field matching
 * - LLM-based subject matching
 */
export async function calculateFullMatch(
  volunteer: {
    causes: string[]
    fieldsOfExpertise: string[]
    subjectsQualified: string[]
  },
  student: {
    cause: string
    fieldsOfStudy: string[]
    topicsNeedSupport: string[]
  }
): Promise<FullMatchResult> {
  const reasons: string[] = []

  // Step 1: Hard-coded cause matching (MANDATORY)
  const causeMatched = matchCause(volunteer.causes, student.cause)
  if (!causeMatched) {
    return {
      isMatch: false,
      score: 0,
      causeMatch: false,
      fieldMatch: { isMatch: false, matchedFields: [] },
      subjectMatch: { matches: [], hasAnyMatch: false, bestMatch: null },
      reasons: ['Cause does not match'],
    }
  }
  reasons.push(`Cause matched: ${student.cause}`)

  // Step 2: Hard-coded field matching
  const fieldMatch = matchFields(volunteer.fieldsOfExpertise, student.fieldsOfStudy)
  if (fieldMatch.isMatch) {
    reasons.push(`Fields matched: ${fieldMatch.matchedFields.join(', ')}`)
  }

  // Step 3: LLM-based subject matching
  let subjectMatch: SubjectMatchResponse = {
    matches: [],
    hasAnyMatch: false,
    bestMatch: null,
  }

  try {
    // Check if Ollama is available
    const ollamaHealthy = await checkOllamaHealth()

    if (ollamaHealthy) {
      subjectMatch = await batchMatchSubjectsWithLLM(
        student.topicsNeedSupport,
        volunteer.subjectsQualified
      )

      if (subjectMatch.hasAnyMatch) {
        const matchDescriptions = subjectMatch.matches
          .slice(0, 3)
          .map(
            (m) =>
              `${m.studentSubject} ≈ ${m.volunteerSubject} (${m.confidence}%)`
          )
        reasons.push(`LLM Subject matches: ${matchDescriptions.join(', ')}`)
      }
    } else {
      // Fallback to basic string matching if Ollama unavailable
      console.warn('Ollama not available, using fallback matching')
      subjectMatch = fallbackSubjectMatch(
        student.topicsNeedSupport,
        volunteer.subjectsQualified
      )
      if (subjectMatch.hasAnyMatch) {
        reasons.push('Subject matches (basic): ' + subjectMatch.matches.map((m: any) => m.studentSubject).join(', '))
      }
    }
  } catch (error) {
    console.error('LLM matching error:', error)
    // Fallback to basic matching
    subjectMatch = fallbackSubjectMatch(
      student.topicsNeedSupport,
      volunteer.subjectsQualified
    )
  }

  // Calculate score
  // Cause: mandatory (no points, just filter)
  // Fields: 30 points
  // Subjects: 70 points
  let score = 0

  if (fieldMatch.isMatch) {
    score += 30
  }

  if (subjectMatch.hasAnyMatch) {
    // Average confidence of matches, scaled to 70 points
    const avgConfidence =
      subjectMatch.matches.reduce((sum: any, m: any) => sum + m.confidence, 0) /
      subjectMatch.matches.length
    score += Math.round((avgConfidence / 100) * 70)
  }

  // Must have at least field OR subject match
  const isMatch = fieldMatch.isMatch || subjectMatch.hasAnyMatch

  return {
    isMatch,
    score,
    causeMatch: true,
    fieldMatch,
    subjectMatch,
    reasons,
  }
}

/**
 * Fallback basic string matching when LLM is unavailable
 */
function fallbackSubjectMatch(
  studentSubjects: string[],
  volunteerSubjects: string[]
): SubjectMatchResponse {
  const matches: SubjectMatchResult[] = []

  for (const ss of studentSubjects) {
    const ssLower = ss.toLowerCase()

    for (const vs of volunteerSubjects) {
      const vsLower = vs.toLowerCase()

      // Check for substring match or common abbreviations
      const isMatch =
        ssLower.includes(vsLower) ||
        vsLower.includes(ssLower) ||
        checkAbbreviation(ssLower, vsLower)

      if (isMatch) {
        matches.push({
          studentSubject: ss,
          volunteerSubject: vs,
          isMatch: true,
          confidence: 70,
          reason: 'Basic string match',
        })
      }
    }
  }

  return {
    matches,
    hasAnyMatch: matches.length > 0,
    bestMatch: matches.length > 0 ? matches[0] : null,
  }
}

/**
 * Check common abbreviations and synonyms
 */
function checkAbbreviation(a: string, b: string): boolean {
  const abbreviations: Record<string, string[]> = {
    // Computer Science & Programming
    ai: ['artificial intelligence', 'machine intelligence'],
    ml: ['machine learning'],
    dl: ['deep learning', 'neural networks'],
    nlp: ['natural language processing'],
    cv: ['computer vision', 'image processing'],
    ds: ['data science', 'data structures'],
    db: ['database', 'databases', 'dbms'],
    dbms: ['database management system', 'database'],
    os: ['operating system', 'operating systems'],
    oop: ['object oriented programming', 'object-oriented programming'],
    dsa: ['data structures and algorithms'],
    cs: ['computer science', 'computing'],
    se: ['software engineering', 'software development'],
    ui: ['user interface'],
    ux: ['user experience'],
    api: ['application programming interface'],
    sql: ['structured query language'],
    js: ['javascript'],
    ts: ['typescript'],
    py: ['python'],
    cpp: ['c++', 'c plus plus'],
    'c++': ['cpp', 'c plus plus'],
    iot: ['internet of things'],
    qa: ['quality assurance', 'software testing'],
    devops: ['development operations'],

    // Mathematics
    calc: ['calculus'],
    stats: ['statistics'],
    la: ['linear algebra'],
    prob: ['probability'],
    trig: ['trigonometry'],
    geo: ['geometry'],
    alg: ['algebra'],

    // Science
    bio: ['biology'],
    chem: ['chemistry'],
    phys: ['physics'],
    biochem: ['biochemistry'],
    orgo: ['organic chemistry'],
    ochem: ['organic chemistry'],
    micro: ['microbiology'],
    neuro: ['neuroscience', 'neurology'],
    psych: ['psychology'],

    // Engineering
    ee: ['electrical engineering'],
    me: ['mechanical engineering'],
    ce: ['civil engineering', 'computer engineering'],
    che: ['chemical engineering'],

    // Business
    pm: ['project management'],
    ba: ['business analysis', 'business administration'],
    hr: ['human resources'],
    mktg: ['marketing'],
    fin: ['finance'],
    econ: ['economics'],

    // Medicine
    med: ['medicine', 'medical'],
    pharma: ['pharmacy', 'pharmacology'],
    anat: ['anatomy'],
    physio: ['physiology'],
  }

  for (const [abbr, fullForms] of Object.entries(abbreviations)) {
    if (
      (a === abbr && fullForms.some((f: any) => b.includes(f))) ||
      (b === abbr && fullForms.some((f: any) => a.includes(f)))
    ) {
      return true
    }
  }

  return false
}
