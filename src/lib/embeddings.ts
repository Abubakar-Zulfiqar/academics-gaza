import prisma from './prisma'

// Use dynamic import for transformers to avoid SSR issues
let pipeline: typeof import('@xenova/transformers').pipeline | null = null
let featureExtractor: Awaited<ReturnType<typeof import('@xenova/transformers').pipeline>> | null = null

// Initialize the embedding model (runs locally, no API needed)
async function getExtractor() {
  if (featureExtractor) return featureExtractor

  if (!pipeline) {
    const { pipeline: p } = await import('@xenova/transformers')
    pipeline = p
  }

  // Use all-MiniLM-L6-v2 - a lightweight but effective embedding model
  // This runs 100% locally, no API calls needed
  featureExtractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  return featureExtractor
}

// In-memory cache for embeddings during a session
const embeddingCache = new Map<string, number[]>()

// Cosine similarity between two vectors
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Get embedding for a single text using local model
export async function getEmbedding(text: string): Promise<number[]> {
  const normalizedText = text.toLowerCase().trim()

  // Check in-memory cache first
  if (embeddingCache.has(normalizedText)) {
    return embeddingCache.get(normalizedText)!
  }

  // Check database cache
  const cached = await prisma.embeddingCache.findUnique({
    where: { text: normalizedText },
  }).catch(() => null)

  if (cached) {
    const embedding = cached.embedding as number[]
    embeddingCache.set(normalizedText, embedding)
    return embedding
  }

  // Generate new embedding using local transformer model
  try {
    const extractor = await getExtractor()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await (extractor as any)(normalizedText, { pooling: 'mean', normalize: true })

    // Convert to regular array
    const embedding = Array.from(output.data as Float32Array)

    // Cache in database
    await prisma.embeddingCache.upsert({
      where: { text: normalizedText },
      update: { embedding, updatedAt: new Date() },
      create: { text: normalizedText, embedding },
    }).catch((e) => console.error('Failed to cache embedding:', e))

    // Cache in memory
    embeddingCache.set(normalizedText, embedding)

    return embedding
  } catch (error) {
    console.error('Error generating embedding:', error)
    // Return empty array on error - will fall back to basic matching
    return []
  }
}

// Get embeddings for multiple texts (batched for efficiency)
export async function getEmbeddings(texts: string[]): Promise<Map<string, number[]>> {
  const results = new Map<string, number[]>()
  const textsToFetch: string[] = []
  const normalizedTexts = texts.map((t: any) => t.toLowerCase().trim())

  // Check caches first
  for (const text of normalizedTexts) {
    if (embeddingCache.has(text)) {
      results.set(text, embeddingCache.get(text)!)
    } else {
      textsToFetch.push(text)
    }
  }

  if (textsToFetch.length === 0) {
    return results
  }

  // Check database cache for remaining
  const dbCached = await prisma.embeddingCache.findMany({
    where: { text: { in: textsToFetch } },
  }).catch(() => [])

  const dbCachedTexts = new Set<string>()
  for (const cached of dbCached) {
    const embedding = cached.embedding as number[]
    results.set(cached.text, embedding)
    embeddingCache.set(cached.text, embedding)
    dbCachedTexts.add(cached.text)
  }

  // Filter out DB cached texts
  const textsToGenerate = textsToFetch.filter((t: any) => !dbCachedTexts.has(t))

  if (textsToGenerate.length === 0) {
    return results
  }

  // Generate embeddings for remaining texts using local model
  try {
    const extractor = await getExtractor()

    for (const text of textsToGenerate) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await (extractor as any)(text, { pooling: 'mean', normalize: true })
      const embedding = Array.from(output.data as Float32Array)

      results.set(text, embedding)
      embeddingCache.set(text, embedding)

      // Cache in database (async, don't wait)
      prisma.embeddingCache.upsert({
        where: { text },
        update: { embedding, updatedAt: new Date() },
        create: { text, embedding },
      }).catch((e) => console.error('Failed to cache embedding:', e))
    }
  } catch (error) {
    console.error('Error generating embeddings:', error)
  }

  return results
}

// Calculate semantic similarity between two texts
export async function calculateSemanticSimilarity(
  text1: string,
  text2: string
): Promise<number> {
  const [embedding1, embedding2] = await Promise.all([
    getEmbedding(text1),
    getEmbedding(text2),
  ])

  if (embedding1.length === 0 || embedding2.length === 0) {
    return 0
  }

  return cosineSimilarity(embedding1, embedding2)
}

// Find best semantic matches from a list of candidates
export async function findBestSemanticMatches(
  target: string,
  candidates: string[],
  minSimilarity: number = 0.5
): Promise<Array<{ candidate: string; similarity: number }>> {
  if (candidates.length === 0) return []

  const allTexts = [target, ...candidates]
  const embeddings = await getEmbeddings(allTexts)

  const targetEmbedding = embeddings.get(target.toLowerCase().trim())
  if (!targetEmbedding || targetEmbedding.length === 0) {
    return []
  }

  const matches: Array<{ candidate: string; similarity: number }> = []

  for (const candidate of candidates) {
    const candidateEmbedding = embeddings.get(candidate.toLowerCase().trim())
    if (candidateEmbedding && candidateEmbedding.length > 0) {
      const similarity = cosineSimilarity(targetEmbedding, candidateEmbedding)
      if (similarity >= minSimilarity) {
        matches.push({ candidate, similarity })
      }
    }
  }

  // Sort by similarity descending
  matches.sort((a: any, b: any) => b.similarity - a.similarity)

  return matches
}

// Comprehensive abbreviations and synonyms mapping
const ABBREVIATIONS: Record<string, string[]> = {
  // Computer Science & Programming
  'ai': ['artificial intelligence', 'machine intelligence'],
  'ml': ['machine learning'],
  'dl': ['deep learning', 'neural networks'],
  'nlp': ['natural language processing', 'text processing', 'language processing'],
  'cv': ['computer vision', 'image processing', 'image recognition'],
  'cs': ['computer science', 'computing'],
  'ds': ['data science', 'data structures'],
  'db': ['database', 'databases', 'dbms'],
  'dbms': ['database management system', 'database', 'databases'],
  'oop': ['object oriented programming', 'object-oriented programming'],
  'dsa': ['data structures and algorithms', 'data structures', 'algorithms'],
  'os': ['operating systems', 'operating system'],
  'se': ['software engineering', 'software development'],
  'ui': ['user interface', 'interface design'],
  'ux': ['user experience', 'user experience design'],
  'api': ['application programming interface'],
  'sql': ['structured query language', 'database query'],
  'html': ['hypertext markup language', 'web markup'],
  'css': ['cascading style sheets', 'web styling'],
  'js': ['javascript', 'ecmascript'],
  'ts': ['typescript'],
  'py': ['python'],
  'cpp': ['c++', 'c plus plus'],
  'c++': ['cpp', 'c plus plus'],
  'iot': ['internet of things'],
  'qa': ['quality assurance', 'software testing', 'testing'],
  'devops': ['development operations', 'ci/cd'],
  'aws': ['amazon web services', 'cloud computing'],
  'gcp': ['google cloud platform', 'cloud computing'],

  // Mathematics
  'calc': ['calculus'],
  'stats': ['statistics', 'statistical analysis'],
  'la': ['linear algebra'],
  'de': ['differential equations'],
  'ode': ['ordinary differential equations'],
  'pde': ['partial differential equations'],
  'prob': ['probability', 'probability theory'],
  'trig': ['trigonometry'],
  'geo': ['geometry'],
  'alg': ['algebra'],

  // Science
  'bio': ['biology', 'biological sciences'],
  'chem': ['chemistry'],
  'phys': ['physics'],
  'biochem': ['biochemistry'],
  'orgo': ['organic chemistry'],
  'ochem': ['organic chemistry'],
  'inorganic': ['inorganic chemistry'],
  'micro': ['microbiology'],
  'neuro': ['neuroscience', 'neurology'],
  'psych': ['psychology'],
  'astro': ['astronomy', 'astrophysics'],

  // Engineering
  'ee': ['electrical engineering', 'electronics'],
  'me': ['mechanical engineering'],
  'ce': ['civil engineering', 'computer engineering'],
  'che': ['chemical engineering'],
  'ae': ['aerospace engineering'],
  'bme': ['biomedical engineering'],

  // Business & Management
  'pm': ['project management'],
  'ba': ['business analysis', 'business administration'],
  'mba': ['master of business administration', 'business administration'],
  'hr': ['human resources'],
  'mktg': ['marketing'],
  'fin': ['finance', 'financial'],
  'acct': ['accounting'],
  'econ': ['economics'],

  // Medicine & Health
  'med': ['medicine', 'medical'],
  'pharma': ['pharmacy', 'pharmacology', 'pharmaceutical'],
  'anat': ['anatomy'],
  'physio': ['physiology'],
  'path': ['pathology'],
  'cardio': ['cardiology', 'cardiovascular'],
  'peds': ['pediatrics'],
  'surg': ['surgery', 'surgical'],
  'rad': ['radiology'],
  'onco': ['oncology'],

  // General Academic
  'lit': ['literature'],
  'phil': ['philosophy'],
  'hist': ['history'],
  'poli sci': ['political science'],
  'polisci': ['political science'],
  'soc': ['sociology'],
  'anthro': ['anthropology'],
  'ling': ['linguistics'],
  'env': ['environmental science', 'environment'],
}

// Reverse mapping for faster lookup (full form -> abbreviations)
const REVERSE_ABBREVIATIONS: Record<string, string[]> = {}
for (const [abbr, fullForms] of Object.entries(ABBREVIATIONS)) {
  for (const fullForm of fullForms) {
    if (!REVERSE_ABBREVIATIONS[fullForm]) {
      REVERSE_ABBREVIATIONS[fullForm] = []
    }
    REVERSE_ABBREVIATIONS[fullForm].push(abbr)
  }
}

// Synonym groups - terms that are semantically equivalent
const SYNONYM_GROUPS: string[][] = [
  ['artificial intelligence', 'ai', 'machine intelligence'],
  ['machine learning', 'ml', 'statistical learning'],
  ['deep learning', 'dl', 'neural networks', 'neural network'],
  ['programming', 'coding', 'software development'],
  ['web development', 'web dev', 'frontend', 'front-end', 'backend', 'back-end'],
  ['data analysis', 'data analytics', 'data science'],
  ['calculus', 'calc', 'differential calculus', 'integral calculus'],
  ['organic chemistry', 'orgo', 'ochem'],
  ['project management', 'pm', 'project planning'],
]

// Build synonym lookup map
const SYNONYM_MAP: Record<string, Set<string>> = {}
for (const group of SYNONYM_GROUPS) {
  const normalizedGroup = group.map((s: any) => s.toLowerCase())
  for (const term of normalizedGroup) {
    if (!SYNONYM_MAP[term]) {
      SYNONYM_MAP[term] = new Set()
    }
    for (const synonym of normalizedGroup) {
      if (synonym !== term) {
        SYNONYM_MAP[term].add(synonym)
      }
    }
  }
}

// Check if two strings are equivalent (exact match, abbreviation, synonym, or contains)
export function isStringMatch(str1: string, str2: string): { isMatch: boolean; similarity: number } {
  const s1 = str1.toLowerCase().trim()
  const s2 = str2.toLowerCase().trim()

  // Exact match
  if (s1 === s2) {
    return { isMatch: true, similarity: 100 }
  }

  // Check synonyms first (highest confidence for known synonyms)
  if (SYNONYM_MAP[s1]?.has(s2) || SYNONYM_MAP[s2]?.has(s1)) {
    return { isMatch: true, similarity: 98 }
  }

  // Check abbreviations both ways
  for (const [abbr, fullForms] of Object.entries(ABBREVIATIONS)) {
    // s1 is abbreviation, s2 is full form (or contains it)
    if (s1 === abbr && fullForms.some(f => s2.includes(f) || f.includes(s2))) {
      return { isMatch: true, similarity: 95 }
    }
    // s2 is abbreviation, s1 is full form (or contains it)
    if (s2 === abbr && fullForms.some(f => s1.includes(f) || f.includes(s1))) {
      return { isMatch: true, similarity: 95 }
    }
    // s1 contains abbreviation, s2 is full form
    if (s1.includes(abbr) && fullForms.some(f => s2.includes(f))) {
      return { isMatch: true, similarity: 90 }
    }
    // s2 contains abbreviation, s1 is full form
    if (s2.includes(abbr) && fullForms.some(f => s1.includes(f))) {
      return { isMatch: true, similarity: 90 }
    }
  }

  // Check reverse abbreviations (full form -> abbr)
  for (const [fullForm, abbrs] of Object.entries(REVERSE_ABBREVIATIONS)) {
    if (s1.includes(fullForm) && abbrs.some(a => s2 === a || s2.includes(a))) {
      return { isMatch: true, similarity: 95 }
    }
    if (s2.includes(fullForm) && abbrs.some(a => s1 === a || s1.includes(a))) {
      return { isMatch: true, similarity: 95 }
    }
  }

  // Word-level partial matching (for multi-word terms)
  const words1 = s1.split(/\s+/)
  const words2 = s2.split(/\s+/)
  const commonWords = words1.filter((w: any) => words2.includes(w) && w.length > 2)
  if (commonWords.length > 0) {
    const matchRatio = commonWords.length / Math.max(words1.length, words2.length)
    if (matchRatio >= 0.5) {
      return { isMatch: true, similarity: Math.round(70 + (20 * matchRatio)) }
    }
  }

  // One contains the other (for compound terms)
  if (s1.includes(s2) || s2.includes(s1)) {
    const longer = s1.length > s2.length ? s1 : s2
    const shorter = s1.length > s2.length ? s2 : s1
    // Only match if the shorter string is meaningful (at least 3 chars)
    if (shorter.length >= 3) {
      const similarity = Math.round(70 + (25 * shorter.length / longer.length))
      return { isMatch: true, similarity }
    }
  }

  return { isMatch: false, similarity: 0 }
}

// Calculate smart subject match score using embeddings
export async function calculateEmbeddingSubjectScore(
  volunteerSubjects: string[],
  studentTopics: string[]
): Promise<{
  score: number
  matchedPairs: Array<{ volunteer: string; student: string; similarity: number }>
}> {
  if (volunteerSubjects.length === 0 || studentTopics.length === 0) {
    return { score: 0, matchedPairs: [] }
  }

  const matchedPairs: Array<{ volunteer: string; student: string; similarity: number }> = []
  const usedVolunteerIndices = new Set<number>()
  const matchedTopicIndices = new Set<number>()

  // FIRST PASS: Check for exact/abbreviation/contains matches (no embeddings needed)
  for (let t = 0; t < studentTopics.length; t++) {
    if (matchedTopicIndices.has(t)) continue
    const topic = studentTopics[t]

    for (let v = 0; v < volunteerSubjects.length; v++) {
      if (usedVolunteerIndices.has(v)) continue
      const subject = volunteerSubjects[v]

      const { isMatch, similarity } = isStringMatch(topic, subject)
      if (isMatch) {
        matchedPairs.push({
          volunteer: subject,
          student: topic,
          similarity: similarity, // Already 0-100 scale
        })
        usedVolunteerIndices.add(v)
        matchedTopicIndices.add(t)
        break
      }
    }
  }

  // SECOND PASS: Use embeddings for remaining unmatched topics
  const unmatchedTopics = studentTopics.filter((_, i) => !matchedTopicIndices.has(i))
  const availableSubjects = volunteerSubjects.filter((_, i) => !usedVolunteerIndices.has(i))

  if (unmatchedTopics.length > 0 && availableSubjects.length > 0) {
    try {
      const allTexts = [...availableSubjects, ...unmatchedTopics]
      const embeddings = await getEmbeddings(allTexts)

      const usedAvailableIndices = new Set<number>()

      for (const topic of unmatchedTopics) {
        const topicEmbedding = embeddings.get(topic.toLowerCase().trim())
        if (!topicEmbedding || topicEmbedding.length === 0) continue

        let bestMatch = { index: -1, subject: '', similarity: 0 }

        for (let i = 0; i < availableSubjects.length; i++) {
          if (usedAvailableIndices.has(i)) continue

          const volunteerEmbedding = embeddings.get(availableSubjects[i].toLowerCase().trim())
          if (!volunteerEmbedding || volunteerEmbedding.length === 0) continue

          const similarity = cosineSimilarity(topicEmbedding, volunteerEmbedding)

          // Threshold for semantic matching
          if (similarity > bestMatch.similarity && similarity >= 0.5) {
            bestMatch = { index: i, subject: availableSubjects[i], similarity }
          }
        }

        if (bestMatch.index >= 0) {
          usedAvailableIndices.add(bestMatch.index)
          matchedPairs.push({
            volunteer: bestMatch.subject,
            student: topic,
            similarity: bestMatch.similarity,
          })
        }
      }
    } catch (error) {
      console.error('Embedding matching failed:', error)
    }
  }

  // Calculate overall score
  // Note: similarity is already 0-100, so don't multiply by 100 again
  const matchRatio = matchedPairs.length / studentTopics.length
  const avgSimilarity =
    matchedPairs.length > 0
      ? matchedPairs.reduce((sum: number, p: { similarity: number }) => sum + p.similarity, 0) / matchedPairs.length
      : 0

  const score = matchRatio * avgSimilarity  // matchRatio (0-1) * avgSimilarity (0-100) = score (0-100)

  return { score, matchedPairs }
}

// Calculate field similarity using embeddings
export async function calculateEmbeddingFieldScore(
  volunteerFields: string[],
  studentFields: string[]
): Promise<{
  score: number
  matchedPairs: Array<{ volunteer: string; student: string; similarity: number }>
}> {
  if (volunteerFields.length === 0 || studentFields.length === 0) {
    return { score: 0, matchedPairs: [] }
  }

  const allTexts = [...volunteerFields, ...studentFields]
  const embeddings = await getEmbeddings(allTexts)

  const matchedPairs: Array<{ volunteer: string; student: string; similarity: number }> = []
  const usedStudentIndices = new Set<number>()

  for (const vField of volunteerFields) {
    const vFieldEmbedding = embeddings.get(vField.toLowerCase().trim())
    if (!vFieldEmbedding || vFieldEmbedding.length === 0) continue

    let bestMatch = { index: -1, field: '', similarity: 0 }

    for (let i = 0; i < studentFields.length; i++) {
      if (usedStudentIndices.has(i)) continue

      const sFieldEmbedding = embeddings.get(studentFields[i].toLowerCase().trim())
      if (!sFieldEmbedding || sFieldEmbedding.length === 0) continue

      const similarity = cosineSimilarity(vFieldEmbedding, sFieldEmbedding)

      // 0.4 threshold to catch related fields like "Computer Science" <-> "Information Technology"
      if (similarity > bestMatch.similarity && similarity >= 0.4) {
        bestMatch = { index: i, field: studentFields[i], similarity }
      }
    }

    if (bestMatch.index >= 0) {
      usedStudentIndices.add(bestMatch.index)
      matchedPairs.push({
        volunteer: vField,
        student: bestMatch.field,
        similarity: bestMatch.similarity,
      })
    }
  }

  if (matchedPairs.length === 0) {
    return { score: 0, matchedPairs: [] }
  }

  const avgSimilarity = matchedPairs.reduce((sum: number, p: { similarity: number }) => sum + p.similarity, 0) / matchedPairs.length
  const score = avgSimilarity * 100

  return { score, matchedPairs }
}

// Full match score calculation using embeddings
export async function calculateMatchScoreWithEmbeddings(
  volunteer: {
    cause: string
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
): Promise<{
  score: number
  reasons: string[]
  matchedSubjects?: Array<{ volunteer: string; student: string; similarity: number }>
  matchedFields?: Array<{ volunteer: string; student: string; similarity: number }>
}> {
  // Mandatory: Same cause
  if (volunteer.cause !== student.cause) {
    return { score: 0, reasons: ['Different causes'] }
  }

  // Check availability
  if (volunteer.currentCapacity >= volunteer.maxCapacity) {
    return { score: 0, reasons: ['Volunteer at max capacity'] }
  }

  let score = 0
  const reasons: string[] = []

  // Get ALL student topics (not just unassigned) for matching
  const studentTopics = student.topicsNeedSupport.map((t: any) => t.keyword)

  // Calculate subject matching first (most important - 40 points)
  let subjectResult = { score: 0, matchedPairs: [] as Array<{ volunteer: string; student: string; similarity: number }> }

  if (studentTopics.length > 0 && volunteer.subjectsQualified.length > 0) {
    subjectResult = await calculateEmbeddingSubjectScore(
      volunteer.subjectsQualified,
      studentTopics
    )

    if (subjectResult.matchedPairs.length > 0) {
      // Scale subject score from 0-100 to 0-40 (primary matching criteria)
      const subjectScore = Math.round(subjectResult.score * 0.4)
      score += subjectScore

      const matchDescriptions = subjectResult.matchedPairs.map((p: any) => {
        // Note: p.similarity is already 0-100 from isStringMatch
        const similarity = Math.round(p.similarity)
        return p.volunteer.toLowerCase() === p.student.toLowerCase()
          ? p.volunteer
          : `${p.student} ≈ ${p.volunteer} (${similarity}%)`
      })
      reasons.push(`Subject matches: ${matchDescriptions.join(', ')}`)
    }
  }

  // Calculate field similarity using embeddings (30 points)
  const fieldResult = await calculateEmbeddingFieldScore(
    volunteer.fieldsOfExpertise,
    student.fieldsOfStudy
  )

  if (fieldResult.matchedPairs.length > 0) {
    const avgFieldSimilarity = fieldResult.matchedPairs.reduce((sum: any, m: any) => sum + m.similarity, 0) / fieldResult.matchedPairs.length
    const fieldScore = Math.round(30 * avgFieldSimilarity)
    score += fieldScore

    const matchedFieldNames = fieldResult.matchedPairs.map((m: any) =>
      m.volunteer.toLowerCase() === m.student.toLowerCase()
        ? m.volunteer
        : `${m.student} ≈ ${m.volunteer} (${Math.round(m.similarity * 100)}%)`
    )
    reasons.push(`Field match: ${matchedFieldNames.join(', ')}`)
  }

  // Must have at least subject OR field match to be valid
  if (subjectResult.matchedPairs.length === 0 && fieldResult.matchedPairs.length === 0) {
    return { score: 0, reasons: ['No subject or field overlap'] }
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
    matchedSubjects: subjectResult.matchedPairs,
    matchedFields: fieldResult.matchedPairs,
  }
}
