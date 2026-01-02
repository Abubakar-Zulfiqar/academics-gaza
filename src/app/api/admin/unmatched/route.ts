import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// STRICT field matching - only exact matches
function isExactFieldMatch(field1: string, field2: string): boolean {
  const f1 = field1.toLowerCase().trim()
  const f2 = field2.toLowerCase().trim()
  if (f1 === f2) return true

  const FIELD_ABBREVIATIONS: Record<string, string[]> = {
    'cs': ['computer science'],
    'se': ['software engineering'],
    'ee': ['electrical engineering'],
    'ce': ['civil engineering', 'computer engineering'],
    'me': ['mechanical engineering'],
    'math': ['mathematics', 'maths'],
    'med': ['medicine', 'medical sciences'],
    'ds': ['data science'],
  }

  for (const [abbr, fullForms] of Object.entries(FIELD_ABBREVIATIONS)) {
    const f1Matches = f1 === abbr || fullForms.some(f => f === f1)
    const f2Matches = f2 === abbr || fullForms.some(f => f === f2)
    if (f1Matches && f2Matches) return true
  }

  return false
}

function hasFieldMatch(fields1: string[], fields2: string[]): boolean {
  for (const f1 of fields1) {
    for (const f2 of fields2) {
      if (isExactFieldMatch(f1, f2)) return true
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

    // Get all students and volunteers
    const [allStudents, allVolunteers, activeMatches] = await Promise.all([
      prisma.student.findMany({
        select: {
          id: true,
          fullName: true,
          cause: true,
          fieldsOfStudy: true,
          topicsNeedSupport: true,
          preferredLanguage: true,
          currentCity: true,
          currentCountry: true,
        },
      }),
      prisma.volunteer.findMany({
        select: {
          id: true,
          fullName: true,
          causes: true,
          fieldsOfExpertise: true,
          subjectsQualified: true,
          preferredLanguage: true,
          city: true,
          country: true,
          currentCapacity: true,
          maxCapacity: true,
        },
      }),
      prisma.match.findMany({
        where: {
          status: {
            notIn: ['rejected', 'not_compatible'],
          },
        },
        select: {
          studentId: true,
          volunteerId: true,
        },
      }),
    ])

    // Create sets of matched IDs
    const matchedStudentIds = new Set(activeMatches.map((m: typeof activeMatches[number]) => m.studentId))
    const matchedVolunteerIds = new Set(activeMatches.map((m: typeof activeMatches[number]) => m.volunteerId))

    // Find TRULY unmatched students - those with NO possible volunteer matches
    const unmatchedStudents = allStudents.filter((student: typeof allStudents[number]) => {
      // Skip if already has an active match
      if (matchedStudentIds.has(student.id)) return false

      // Check if ANY volunteer could match this student
      const hasPossibleMatch = allVolunteers.some((volunteer: typeof allVolunteers[number]) => {
        // Volunteer must support the student's cause
        if (!volunteer.causes.includes(student.cause)) return false
        // Field match required
        if (!hasFieldMatch(volunteer.fieldsOfExpertise, student.fieldsOfStudy)) return false
        // Has capacity
        if (volunteer.currentCapacity >= volunteer.maxCapacity) return false
        // Not already matched with this student
        const existingMatch = activeMatches.find(
          (m: typeof activeMatches[number]) => m.studentId === student.id && m.volunteerId === volunteer.id
        )
        if (existingMatch) return false

        return true
      })

      // Only include in "unmatched" if NO possible matches exist
      return !hasPossibleMatch
    })

    // Find TRULY unmatched volunteers - those with NO possible student matches
    const unmatchedVolunteers = allVolunteers.filter((volunteer: typeof allVolunteers[number]) => {
      // Skip if already has an active match
      if (matchedVolunteerIds.has(volunteer.id)) return false

      // Check if ANY student could match this volunteer
      const hasPossibleMatch = allStudents.some((student: typeof allStudents[number]) => {
        // Volunteer must support the student's cause
        if (!volunteer.causes.includes(student.cause)) return false
        // Field match required
        if (!hasFieldMatch(student.fieldsOfStudy, volunteer.fieldsOfExpertise)) return false
        // Not already matched with this volunteer
        const existingMatch = activeMatches.find(
          (m: typeof activeMatches[number]) => m.studentId === student.id && m.volunteerId === volunteer.id
        )
        if (existingMatch) return false

        return true
      })

      // Only include in "unmatched" if NO possible matches exist
      return !hasPossibleMatch
    })

    return NextResponse.json({
      students: unmatchedStudents,
      volunteers: unmatchedVolunteers,
    })
  } catch (error) {
    console.error('Error fetching unmatched:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
