import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import { calculateMatchScore } from '@/lib/utils'

interface Topic {
  keyword: string
  status: 'unassigned' | 'assigned'
}

interface SuggestedMatch {
  studentId: string
  studentName: string
  volunteerId: string
  volunteerName: string
  score: number
  matchingSubjects: string[]
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { triggerType, entityId } = body

    let suggestions: SuggestedMatch[] = []

    if (triggerType === 'new_student') {
      // Find matches for a new student
      const student = await prisma.student.findUnique({
        where: { id: entityId },
        include: {
          matches: { select: { volunteerId: true } },
        },
      })

      if (!student) {
        return NextResponse.json({ error: 'Student not found' }, { status: 404 })
      }

      const topics = student.topicsNeedSupport as unknown as Topic[]
      const unassignedTopics = topics
        .filter((t: any) => t.status === 'unassigned')
        .map((t: any) => t.keyword)

      if (unassignedTopics.length === 0) {
        return NextResponse.json({ suggestions: [] })
      }

      const existingVolunteerIds = student.matches.map((m: any) => m.volunteerId)

      const allVolunteers = await prisma.volunteer.findMany({
        where: {
          id: { notIn: existingVolunteerIds },
          causes: { has: student.cause },
        },
      })
      // Filter volunteers with available capacity
      const volunteers = allVolunteers.filter((v: typeof allVolunteers[number]) => v.currentCapacity < v.maxCapacity)

      suggestions = volunteers
        .map((volunteer: any) => {
          const matchingSubjects = volunteer.subjectsQualified.filter((subject: any) =>
            unassignedTopics.some(
              (topic: string) =>
                topic.toLowerCase().includes(subject.toLowerCase()) ||
                subject.toLowerCase().includes(topic.toLowerCase())
            )
          )

          if (matchingSubjects.length === 0) return null

          const score = calculateMatchScore(
            {
              causes: volunteer.causes,
              fieldsOfExpertise: volunteer.fieldsOfExpertise,
              subjectsQualified: volunteer.subjectsQualified,
              preferredLanguage: volunteer.preferredLanguage,
              hoursPerWeekAvailable: volunteer.hoursPerWeekAvailable,
              currentCapacity: volunteer.currentCapacity,
              maxCapacity: volunteer.maxCapacity,
            },
            {
              cause: student.cause,
              fieldsOfStudy: student.fieldsOfStudy,
              topicsNeedSupport: unassignedTopics.map((t: string) => ({ keyword: t, status: 'unassigned' })),
              preferredLanguage: student.preferredLanguage,
              hoursPerWeekNeeded: student.hoursPerWeekNeeded,
            }
          )

          return {
            studentId: student.id,
            studentName: student.fullName,
            volunteerId: volunteer.id,
            volunteerName: volunteer.fullName,
            score: score.score,
            matchingSubjects,
          }
        })
        .filter((s: any): s is NonNullable<typeof s> => s !== null)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10)
    } else if (triggerType === 'capacity_change') {
      // Find students that could be matched with a volunteer whose capacity increased
      const volunteer = await prisma.volunteer.findUnique({
        where: { id: entityId },
        include: {
          matches: { select: { studentId: true } },
        },
      })

      if (!volunteer) {
        return NextResponse.json({ error: 'Volunteer not found' }, { status: 404 })
      }

      if (volunteer.currentCapacity >= volunteer.maxCapacity) {
        return NextResponse.json({ suggestions: [] })
      }

      const existingStudentIds = volunteer.matches.map((m: any) => m.studentId)

      const students = await prisma.student.findMany({
        where: {
          id: { notIn: existingStudentIds },
          cause: { in: volunteer.causes },
        },
      })

      suggestions = students
        .map((student: any) => {
          const topics = student.topicsNeedSupport as unknown as Topic[]
          const unassignedTopics = topics
            .filter((t: any) => t.status === 'unassigned')
            .map((t: any) => t.keyword)

          if (unassignedTopics.length === 0) return null

          const matchingSubjects = volunteer.subjectsQualified.filter((subject: any) =>
            unassignedTopics.some(
              (topic: string) =>
                topic.toLowerCase().includes(subject.toLowerCase()) ||
                subject.toLowerCase().includes(topic.toLowerCase())
            )
          )

          if (matchingSubjects.length === 0) return null

          const score = calculateMatchScore(
            {
              causes: volunteer.causes,
              fieldsOfExpertise: volunteer.fieldsOfExpertise,
              subjectsQualified: volunteer.subjectsQualified,
              preferredLanguage: volunteer.preferredLanguage,
              hoursPerWeekAvailable: volunteer.hoursPerWeekAvailable,
              currentCapacity: volunteer.currentCapacity,
              maxCapacity: volunteer.maxCapacity,
            },
            {
              cause: student.cause,
              fieldsOfStudy: student.fieldsOfStudy,
              topicsNeedSupport: unassignedTopics.map((t: string) => ({ keyword: t, status: 'unassigned' })),
              preferredLanguage: student.preferredLanguage,
              hoursPerWeekNeeded: student.hoursPerWeekNeeded,
            }
          )

          return {
            studentId: student.id,
            studentName: student.fullName,
            volunteerId: volunteer.id,
            volunteerName: volunteer.fullName,
            score: score.score,
            matchingSubjects,
          }
        })
        .filter((s: any): s is NonNullable<typeof s> => s !== null)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10)
    } else if (triggerType === 'full_scan') {
      // Find all potential matches across the platform
      const students = await prisma.student.findMany({
        include: {
          matches: { select: { volunteerId: true } },
        },
      })

      const allVolunteers = await prisma.volunteer.findMany()
      // Filter volunteers with available capacity
      const volunteers = allVolunteers.filter((v: typeof allVolunteers[number]) => v.currentCapacity < v.maxCapacity)

      for (const student of students) {
        const topics = student.topicsNeedSupport as unknown as Topic[]
        const unassignedTopics = topics
          .filter((t: any) => t.status === 'unassigned')
          .map((t: any) => t.keyword)

        if (unassignedTopics.length === 0) continue

        const existingVolunteerIds = student.matches.map((m: any) => m.volunteerId)

        for (const volunteer of volunteers) {
          if (existingVolunteerIds.includes(volunteer.id)) continue
          if (!volunteer.causes.includes(student.cause)) continue

          const matchingSubjects = volunteer.subjectsQualified.filter((subject: any) =>
            unassignedTopics.some(
              (topic: string) =>
                topic.toLowerCase().includes(subject.toLowerCase()) ||
                subject.toLowerCase().includes(topic.toLowerCase())
            )
          )

          if (matchingSubjects.length === 0) continue

          const score = calculateMatchScore(
            {
              causes: volunteer.causes,
              fieldsOfExpertise: volunteer.fieldsOfExpertise,
              subjectsQualified: volunteer.subjectsQualified,
              preferredLanguage: volunteer.preferredLanguage,
              hoursPerWeekAvailable: volunteer.hoursPerWeekAvailable,
              currentCapacity: volunteer.currentCapacity,
              maxCapacity: volunteer.maxCapacity,
            },
            {
              cause: student.cause,
              fieldsOfStudy: student.fieldsOfStudy,
              topicsNeedSupport: unassignedTopics.map((t: string) => ({ keyword: t, status: 'unassigned' })),
              preferredLanguage: student.preferredLanguage,
              hoursPerWeekNeeded: student.hoursPerWeekNeeded,
            }
          )

          suggestions.push({
            studentId: student.id,
            studentName: student.fullName,
            volunteerId: volunteer.id,
            volunteerName: volunteer.fullName,
            score: score.score,
            matchingSubjects,
          })
        }
      }

      suggestions = suggestions.sort((a: any, b: any) => b.score - a.score).slice(0, 50)
    }

    // Log the trigger (only if it's a valid trigger type)
    if (['new_student', 'new_volunteer', 'capacity_change'].includes(triggerType)) {
      await prisma.matchTrigger.create({
        data: {
          triggerType: triggerType as 'new_student' | 'capacity_change' | 'new_volunteer',
          entityId: entityId || '',
          matchesFound: suggestions.length,
          processed: true,
          processedAt: new Date(),
        },
      })
    }

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Error running matching trigger:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
