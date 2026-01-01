import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { calculateEmbeddingSubjectScore } from '@/lib/embeddings'

interface Topic {
  keyword: string
  status: string
}

interface VolunteerExistingMatch {
  studentName: string
  status: string
  subjects: string[]
}

interface MatchingKeyword {
  studentTopic: string
  volunteerSubject: string
  similarity: number
}

interface MatchSuggestion {
  studentId: string
  studentName: string
  studentCause: string
  studentFields: string[]
  studentTopics: string[]
  volunteerId: string
  volunteerName: string
  volunteerEmail: string
  volunteerFields: string[]
  volunteerSubjects: string[]
  score: number
  matchingKeywords: string[]
  matchingKeywordsDetailed: MatchingKeyword[]
  matchingFields: string[]
  volunteerExistingMatches: VolunteerExistingMatch[]
}

// STRICT field matching - only exact matches or true abbreviations (not substring matches)
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

// Get matching fields - STRICT: only exact matches
function getMatchingFields(volunteerFields: string[], studentFields: string[]): string[] {
  const matchingFields: string[] = []

  for (const studentField of studentFields) {
    for (const volunteerField of volunteerFields) {
      if (isExactFieldMatch(studentField, volunteerField)) {
        if (!matchingFields.includes(studentField)) {
          matchingFields.push(studentField)
        }
        // Only add volunteer field if different from student field (to show the match)
        if (!matchingFields.includes(volunteerField) &&
            studentField.toLowerCase() !== volunteerField.toLowerCase()) {
          matchingFields.push(volunteerField)
        }
      }
    }
  }

  return matchingFields
}

// Check if fields/major match - STRICT: only exact matches
function hasFieldMatch(volunteerFields: string[], studentFields: string[]): boolean {
  for (const studentField of studentFields) {
    for (const volunteerField of volunteerFields) {
      if (isExactFieldMatch(studentField, volunteerField)) {
        return true
      }
    }
  }

  return false
}

export async function GET() {
  try {
    const session = await getSession()

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all ACTIVE students with their existing matches (exclude disabled profiles)
    const students = await prisma.student.findMany({
      where: {
        isActive: true, // Only include active students in matching suggestions
      },
      select: {
        id: true,
        fullName: true,
        cause: true,
        fieldsOfStudy: true,
        topicsNeedSupport: true,
        matches: {
          select: {
            volunteerId: true,
            status: true,
          },
        },
      },
    })

    // Get all ACTIVE volunteers with their existing matches (exclude disabled profiles)
    const volunteers = await prisma.volunteer.findMany({
      where: {
        isActive: true, // Only include active volunteers in matching suggestions
      },
      select: {
        id: true,
        fullName: true,
        causes: true,
        fieldsOfExpertise: true,
        subjectsQualified: true,
        user: {
          select: {
            email: true,
          },
        },
        matches: {
          where: {
            status: {
              notIn: ['rejected', 'not_compatible'],
            },
          },
          select: {
            studentId: true,
            status: true,
            assignedSubjects: true,
            student: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
    })

    const suggestions: MatchSuggestion[] = []

    // Compare each student with each volunteer
    for (const student of students) {
      const topics = student.topicsNeedSupport as unknown as Topic[]
      const studentTopics = topics.map((t: Topic) => t.keyword)

      // Get ALL volunteer IDs this student has been matched with (including rejected)
      // This ensures rejected pairs are never suggested again
      const studentMatchedVolunteerIds = student.matches.map((m: any) => m.volunteerId)

      for (const volunteer of volunteers) {
        // Skip if already matched (including rejected - don't re-suggest rejected pairs)
        if (studentMatchedVolunteerIds.includes(volunteer.id)) continue

        // Volunteer must support the student's cause
        if (!volunteer.causes.includes(student.cause)) continue

        // Must have matching field/major (STRICT - only exact matches)
        if (!hasFieldMatch(volunteer.fieldsOfExpertise, student.fieldsOfStudy)) continue

        // Calculate keyword match score using SAME embedding function as Students tab
        const subjectResult = await calculateEmbeddingSubjectScore(
          volunteer.subjectsQualified,
          studentTopics
        )

        // Convert to expected format
        const matchingKeywords = subjectResult.matchedPairs.map((p: { student: string }) => p.student)
        const matchingKeywordsDetailed: MatchingKeyword[] = subjectResult.matchedPairs.map((p: { student: string; volunteer: string; similarity: number }) => ({
          studentTopic: p.student,
          volunteerSubject: p.volunteer,
          similarity: Math.round(p.similarity),
        }))

        // Get matching fields (STRICT)
        const matchingFields = getMatchingFields(volunteer.fieldsOfExpertise, student.fieldsOfStudy)

        // Get volunteer's existing matches
        const volunteerExistingMatches: VolunteerExistingMatch[] = volunteer.matches.map((m: any) => ({
          studentName: m.student.fullName,
          status: m.status,
          subjects: m.assignedSubjects,
        }))

        suggestions.push({
          studentId: student.id,
          studentName: student.fullName,
          studentCause: student.cause,
          studentFields: student.fieldsOfStudy,
          studentTopics,
          volunteerId: volunteer.id,
          volunteerName: volunteer.fullName,
          volunteerEmail: volunteer.user.email,
          volunteerFields: volunteer.fieldsOfExpertise,
          volunteerSubjects: volunteer.subjectsQualified,
          score: Math.round(subjectResult.score),
          matchingKeywords,
          matchingKeywordsDetailed,
          matchingFields,
          volunteerExistingMatches,
        })
      }
    }

    // Sort by score descending
    suggestions.sort((a, b) => b.score - a.score)

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error generating suggestions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
