import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import {
  calculateFullMatch,
  checkOllamaHealth,
  FullMatchResult,
} from '@/lib/llm-matcher'

interface Topic {
  keyword: string
  status: 'unassigned' | 'assigned'
}

interface LLMMatchSuggestion {
  studentId: string
  studentName: string
  studentCause: string
  studentTopics: Topic[]
  volunteerId: string
  volunteerName: string
  volunteerSubjects: string[]
  score: number
  reasons: string[]
  matchDetails: {
    causeMatch: boolean
    fieldMatch: {
      isMatch: boolean
      matchedFields: string[]
    }
    subjectMatch: {
      matches: Array<{
        studentSubject: string
        volunteerSubject: string
        confidence: number
        reason: string
      }>
      hasAnyMatch: boolean
    }
  }
}

/**
 * GET /api/admin/llm-suggestions
 *
 * Get volunteer-student match suggestions using LLM-based matching
 *
 * Uses:
 * - Hard-coded if-else for cause matching (mandatory filter)
 * - Hard-coded if-else for field matching
 * - LLM for semantic subject matching (AI ≈ Artificial Intelligence, etc.)
 */
export async function GET() {
  try {
    const session = await getSession()

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check Ollama status
    const ollamaHealthy = await checkOllamaHealth()

    // Get all students with unassigned topics
    const students = await prisma.student.findMany({
      include: {
        matches: {
          select: { volunteerId: true, status: true },
        },
      },
    })

    // Get all volunteers
    const volunteers = await prisma.volunteer.findMany({
      include: {
        matches: {
          select: { studentId: true, status: true },
        },
      },
    })

    const suggestions: LLMMatchSuggestion[] = []

    // Track processing time
    const startTime = Date.now()

    // Process matches
    for (const student of students) {
      const topics = student.topicsNeedSupport as unknown as Topic[]
      const unassignedTopics = topics.filter((t: any) => t.status === 'unassigned')

      // Skip if no unassigned topics
      if (unassignedTopics.length === 0) continue

      // Get volunteers this student is already matched with
      const existingVolunteerIds = student.matches.map((m: any) => m.volunteerId)

      for (const volunteer of volunteers) {
        // Skip if already matched
        if (existingVolunteerIds.includes(volunteer.id)) continue

        // Skip if volunteer at max capacity
        if (volunteer.currentCapacity >= volunteer.maxCapacity) continue

        // Calculate full match using LLM + hard-coded filters
        const matchResult: FullMatchResult = await calculateFullMatch(
          {
            causes: volunteer.causes,
            fieldsOfExpertise: volunteer.fieldsOfExpertise,
            subjectsQualified: volunteer.subjectsQualified,
          },
          {
            cause: student.cause,
            fieldsOfStudy: student.fieldsOfStudy,
            topicsNeedSupport: unassignedTopics.map((t: any) => t.keyword),
          }
        )

        // Only include if there's a match
        if (!matchResult.isMatch) continue

        suggestions.push({
          studentId: student.id,
          studentName: student.fullName,
          studentCause: student.cause,
          studentTopics: unassignedTopics,
          volunteerId: volunteer.id,
          volunteerName: volunteer.fullName,
          volunteerSubjects: volunteer.subjectsQualified,
          score: matchResult.score,
          reasons: matchResult.reasons,
          matchDetails: {
            causeMatch: matchResult.causeMatch,
            fieldMatch: matchResult.fieldMatch,
            subjectMatch: {
              matches: matchResult.subjectMatch.matches.map((m: any) => ({
                studentSubject: m.studentSubject,
                volunteerSubject: m.volunteerSubject,
                confidence: m.confidence,
                reason: m.reason,
              })),
              hasAnyMatch: matchResult.subjectMatch.hasAnyMatch,
            },
          },
        })
      }
    }

    const processingTime = Date.now() - startTime

    // Sort by score descending
    suggestions.sort((a: any, b: any) => b.score - a.score)

    // Get summary stats
    const studentsNeedingHelp = students.filter((s: any) => {
      const topics = s.topicsNeedSupport as unknown as Topic[]
      return topics.some((t: any) => t.status === 'unassigned')
    })

    const availableVolunteers = volunteers.filter(
      (v: any) => v.currentCapacity < v.maxCapacity
    )

    return NextResponse.json({
      suggestions: suggestions.slice(0, 100), // Limit to top 100
      stats: {
        studentsNeedingHelp: studentsNeedingHelp.length,
        availableVolunteers: availableVolunteers.length,
        totalSuggestions: suggestions.length,
        processingTimeMs: processingTime,
      },
      llmStatus: {
        ollamaHealthy,
        model: process.env.OLLAMA_MODEL || 'qwen2.5:1.5b',
        note: ollamaHealthy
          ? 'Using LLM for semantic subject matching'
          : 'Ollama unavailable - using fallback string matching',
      },
    })
  } catch (error) {
    console.error('Error generating LLM suggestions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
