import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { calculateMatchScore } from '@/lib/utils'

// GET - Get matches based on user role
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const studentId = searchParams.get('studentId')
    const volunteerId = searchParams.get('volunteerId')

    // Valid MatchStatus enum values
    const validStatuses = [
      'auto_suggested',
      'pending_email',
      'email_sent',
      'accepted',
      'active',
      'rejected',
      'not_compatible',
      'completed',
      'paused',
    ]

    let whereClause: Record<string, unknown> = {}

    // Role-based filtering
    if (session.role === 'admin') {
      // Admin can see all matches
      if (status && validStatuses.includes(status)) {
        whereClause.status = status
      }
      if (studentId) whereClause.studentId = studentId
      if (volunteerId) whereClause.volunteerId = volunteerId
    } else if (session.role === 'volunteer') {
      // Volunteer can only see their matches
      const volunteer = await prisma.volunteer.findUnique({
        where: { userId: session.userId },
      })
      if (!volunteer) {
        return NextResponse.json({ error: 'Volunteer profile not found' }, { status: 404 })
      }
      whereClause.volunteerId = volunteer.id
      // Allow filtering by specific status if provided, but only from allowed statuses
      const allowedStatuses = ['email_sent', 'accepted', 'active']
      if (status && allowedStatuses.includes(status)) {
        whereClause.status = status
      } else {
        whereClause.status = { in: allowedStatuses }
      }
    } else if (session.role === 'student') {
      // Student can only see their matches
      const student = await prisma.student.findUnique({
        where: { userId: session.userId },
      })
      if (!student) {
        return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })
      }
      whereClause.studentId = student.id
      whereClause.status = { in: ['accepted', 'active'] }
    }

    const matches = await prisma.match.findMany({
      where: whereClause,
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            cause: true,
            fieldsOfStudy: true,
            topicsNeedSupport: true,
            preferredLanguage: true,
            currentCity: true,
            currentCountry: true,
            hoursPerWeekNeeded: true,
          },
        },
        volunteer: {
          select: {
            id: true,
            fullName: true,
            causes: true,
            fieldsOfExpertise: true,
            subjectsQualified: true,
            preferredLanguage: true,
            currentCapacity: true,
            maxCapacity: true,
          },
        },
        admin: {
          select: {
            id: true,
            email: true,
          },
        },
        sessions: {
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            durationMinutes: true,
            subjectsCovered: true,
          },
          orderBy: { scheduledAt: 'desc' },
        },
      },
      orderBy: [{ status: 'asc' }, { matchScore: 'desc' }, { createdAt: 'desc' }],
    })

    return NextResponse.json({ matches })
  } catch (error) {
    console.error('Get matches error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new match (Admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { studentId, volunteerId, assignedSubjects, adminNotes } = body

    // Check if match already exists
    const existingMatch = await prisma.match.findUnique({
      where: {
        studentId_volunteerId: {
          studentId,
          volunteerId,
        },
      },
    })

    if (existingMatch) {
      return NextResponse.json({ error: 'Match already exists' }, { status: 400 })
    }

    // Get student and volunteer for score calculation
    const [student, volunteer] = await Promise.all([
      prisma.student.findUnique({ where: { id: studentId } }),
      prisma.volunteer.findUnique({ where: { id: volunteerId } }),
    ])

    if (!student || !volunteer) {
      return NextResponse.json({ error: 'Student or volunteer not found' }, { status: 404 })
    }

    // Calculate match score
    const topics = (student.topicsNeedSupport as Array<{ keyword: string; status: string }>) || []
    const { score, reasons } = calculateMatchScore(
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
        topicsNeedSupport: topics,
        preferredLanguage: student.preferredLanguage,
        hoursPerWeekNeeded: student.hoursPerWeekNeeded,
      }
    )

    // Create match and update student topics in a transaction
    const match = await prisma.$transaction(async (tx: typeof prisma) => {
      // Create the match
      const newMatch = await tx.match.create({
        data: {
          studentId,
          volunteerId,
          assignedSubjects,
          matchScore: score,
          matchReasons: reasons,
          status: 'pending_email',
          autoSuggested: false,
          adminId: session.userId,
          adminNotes,
        },
        include: {
          student: true,
          volunteer: true,
        },
      })

      // Update student's topic status to mark assigned subjects
      if (assignedSubjects && assignedSubjects.length > 0) {
        const updatedTopics = topics.map((topic: { keyword: string; status: string }) => {
          if (assignedSubjects.some((s: string) => s.toLowerCase() === topic.keyword.toLowerCase())) {
            return { ...topic, status: 'assigned', assignedTo: volunteerId }
          }
          return topic
        })

        await tx.student.update({
          where: { id: studentId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { topicsNeedSupport: updatedTopics as any },
        })
      }

      return newMatch
    })

    return NextResponse.json({ match, message: 'Match created successfully' })
  } catch (error) {
    console.error('Create match error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
