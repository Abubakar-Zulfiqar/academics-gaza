import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import { calculateEmbeddingSubjectScore } from '@/lib/embeddings'

interface Topic {
  keyword: string
  status: 'unassigned' | 'assigned'
}

// STRICT field matching - only exact matches or true abbreviations
function isExactFieldMatch(field1: string, field2: string): boolean {
  const f1 = field1.toLowerCase().trim()
  const f2 = field2.toLowerCase().trim()

  // Exact match
  if (f1 === f2) return true

  // Known field abbreviations (strict list)
  const FIELD_ABBREVIATIONS: Record<string, string[]> = {
    'cs': ['computer science', 'comp sci', 'comp science'],
    'se': ['software engineering', 'software eng'],
    'ee': ['electrical engineering', 'electrical eng'],
    'ce': ['civil engineering', 'civil eng', 'computer engineering'],
    'me': ['mechanical engineering', 'mechanical eng'],
    'it': ['information technology', 'info tech'],
    'math': ['mathematics', 'maths'],
    'bio': ['biology', 'biological sciences'],
    'chem': ['chemistry', 'chemical sciences'],
    'phy': ['physics', 'physical sciences'],
    'med': ['medicine', 'medical sciences'],
    'ds': ['data science'],
    'ai': ['artificial intelligence'],
    'ml': ['machine learning'],
  }

  // Check if both map to same abbreviation
  for (const [abbr, fullForms] of Object.entries(FIELD_ABBREVIATIONS)) {
    const f1Matches = f1 === abbr || fullForms.some(f => f === f1)
    const f2Matches = f2 === abbr || fullForms.some(f => f === f2)
    if (f1Matches && f2Matches) return true
  }

  return false
}

// Check if major fields match between volunteer and student (STRICT)
function hasFieldMatch(volunteerFields: string[], studentFields: string[]): boolean {
  for (const sf of studentFields) {
    for (const vf of volunteerFields) {
      if (isExactFieldMatch(sf, vf)) return true
    }
  }
  return false
}

// Get the actual matching fields between volunteer and student (STRICT)
function getMatchingFields(volunteerFields: string[], studentFields: string[]): string[] {
  const matchingFields: string[] = []

  for (const sf of studentFields) {
    for (const vf of volunteerFields) {
      if (isExactFieldMatch(sf, vf)) {
        if (!matchingFields.includes(vf)) {
          matchingFields.push(vf)
        }
      }
    }
  }

  return matchingFields
}

// Fallback basic string matching when embeddings fail
// Note: similarity values are 0-100 to match embedding-based matching
function basicSubjectMatch(
  volunteerSubjects: string[],
  studentTopics: string[]
): { matchedPairs: Array<{ volunteer: string; student: string; similarity: number }>; score: number } {
  const matchedPairs: Array<{ volunteer: string; student: string; similarity: number }> = []

  for (const topic of studentTopics) {
    const topicLower = topic.toLowerCase().trim()

    for (const subject of volunteerSubjects) {
      const subjectLower = subject.toLowerCase().trim()

      // Exact match (case-insensitive)
      if (topicLower === subjectLower) {
        matchedPairs.push({ volunteer: subject, student: topic, similarity: 100 })
        break
      }

      // Partial match (one contains the other)
      if (topicLower.includes(subjectLower) || subjectLower.includes(topicLower)) {
        matchedPairs.push({ volunteer: subject, student: topic, similarity: 80 })
        break
      }

      // Common abbreviations
      const abbreviations: Record<string, string[]> = {
        'ai': ['artificial intelligence'],
        'ml': ['machine learning'],
        'dl': ['deep learning'],
        'nlp': ['natural language processing'],
        'cs': ['computer science'],
        'ds': ['data science', 'data structures'],
      }

      for (const [abbr, fullForms] of Object.entries(abbreviations)) {
        if (
          (topicLower === abbr && fullForms.some(f => subjectLower.includes(f))) ||
          (subjectLower === abbr && fullForms.some(f => topicLower.includes(f))) ||
          (fullForms.some(f => topicLower.includes(f)) && fullForms.some(f => subjectLower.includes(f)))
        ) {
          matchedPairs.push({ volunteer: subject, student: topic, similarity: 95 })
          break
        }
      }
    }
  }

  // Score = (matchedCount / totalTopics) * avgSimilarity
  // avgSimilarity is already 0-100
  const matchRatio = matchedPairs.length / studentTopics.length
  const avgSimilarity = matchedPairs.length > 0
    ? matchedPairs.reduce((sum: number, p: { similarity: number }) => sum + p.similarity, 0) / matchedPairs.length
    : 0
  const score = matchRatio * avgSimilarity

  return { matchedPairs, score }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: studentId } = await params
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the student with their matches
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        matches: {
          select: {
            volunteerId: true,
            assignedSubjects: true,
            status: true,
          },
        },
      },
    })

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    // Get unassigned topics
    const topics = student.topicsNeedSupport as unknown as Topic[]
    const unassignedTopics = topics
      .filter((t: any) => t.status === 'unassigned')
      .map((t: any) => t.keyword)

    if (unassignedTopics.length === 0) {
      return NextResponse.json({ suggestions: [] })
    }

    // Create a map of existing matches for quick lookup
    const existingMatchesMap = new Map(
      student.matches.map((m: any) => [m.volunteerId, m])
    )

    // Find ALL volunteers who support the student's cause (including already matched ones)
    const volunteers = await prisma.volunteer.findMany({
      where: {
        causes: { has: student.cause },
      },
    })

    // Filter to only those with:
    // 1. Matching major fields
    // 2. Available capacity OR already matched
    const eligibleVolunteers = volunteers.filter((v: any) => {
      const existingMatch = existingMatchesMap.get(v.id)

      // Must have matching major field
      if (!hasFieldMatch(v.fieldsOfExpertise, student.fieldsOfStudy)) {
        return false
      }

      // Include if: has capacity OR is already matched (can add subjects to existing match)
      return v.currentCapacity < v.maxCapacity || existingMatch
    })

    // Calculate match scores using embeddings with fallback
    const suggestionsWithScores = await Promise.all(
      eligibleVolunteers.map(async (volunteer: any) => {
        let subjectResult: { matchedPairs: Array<{ volunteer: string; student: string; similarity: number }>; score: number }

        try {
          // Try embedding-based subject matching first
          subjectResult = await calculateEmbeddingSubjectScore(
            volunteer.subjectsQualified,
            unassignedTopics
          )

          // If no matches from embeddings, try basic string matching as fallback
          if (subjectResult.matchedPairs.length === 0) {
            subjectResult = basicSubjectMatch(volunteer.subjectsQualified, unassignedTopics)
          }
        } catch (error) {
          console.error('Embedding matching failed, using fallback:', error)
          // Fallback to basic string matching
          subjectResult = basicSubjectMatch(volunteer.subjectsQualified, unassignedTopics)
        }

        // Check if already matched with this student
        const existingMatch = existingMatchesMap.get(volunteer.id)
        const isAlreadyMatched = !!existingMatch

        // Get matching fields between volunteer and student
        const matchingFields = getMatchingFields(volunteer.fieldsOfExpertise, student.fieldsOfStudy)

        // Format matching subjects with similarity scores
        // Note: similarity is already 0-100 from embeddings, no need to multiply
        const matchingSubjects = subjectResult.matchedPairs.map((pair: any) => ({
          volunteer: pair.volunteer,
          student: pair.student,
          similarity: Math.round(pair.similarity),
        }))

        // Calculate score: prioritize subject matches, but give base score for field match
        let finalScore = Math.round(subjectResult.score)
        if (finalScore === 0 && matchingFields.length > 0) {
          // Give a base score of 20 for field match even without subject match
          finalScore = 20
        }

        return {
          volunteerId: volunteer.id,
          volunteerName: volunteer.fullName,
          score: finalScore,
          matchingSubjects,
          matchingFields,
          subjectsQualified: volunteer.subjectsQualified,
          availableCapacity: volunteer.maxCapacity - volunteer.currentCapacity,
          preferredLanguage: volunteer.preferredLanguage,
          isAlreadyMatched,
          existingMatchStatus: existingMatch?.status || null,
          existingAssignedSubjects: existingMatch?.assignedSubjects || [],
        }
      })
    )

    // Filter out null results and sort by score (prioritize already matched volunteers)
    const suggestions = suggestionsWithScores
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a: any, b: any) => {
        // Prioritize already matched volunteers (they're easier to add subjects to)
        if (a.isAlreadyMatched && !b.isAlreadyMatched) return -1
        if (!a.isAlreadyMatched && b.isAlreadyMatched) return 1
        // Then sort by score
        return b.score - a.score
      })
      .slice(0, 10) // Return top 10 matches

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error fetching suggestions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
