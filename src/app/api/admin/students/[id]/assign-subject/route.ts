import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import { z } from 'zod'

interface TopicWithAssignment {
  keyword: string
  status: 'unassigned' | 'assigned'
  assignedTo: string | null
  volunteerName?: string
}

const assignSubjectSchema = z.object({
  subjectKeyword: z.string().min(1),
  volunteerId: z.string().uuid(),
})

const unassignSubjectSchema = z.object({
  subjectKeyword: z.string().min(1),
})

// POST - Assign a subject to a volunteer
export async function POST(
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

    const body = await request.json()
    const validation = assignSubjectSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: validation.error.issues },
        { status: 400 }
      )
    }

    const { subjectKeyword, volunteerId } = validation.data

    // Get student and volunteer
    const [student, volunteer] = await Promise.all([
      prisma.student.findUnique({ where: { id: studentId } }),
      prisma.volunteer.findUnique({ where: { id: volunteerId } }),
    ])

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    if (!volunteer) {
      return NextResponse.json({ error: 'Volunteer not found' }, { status: 404 })
    }

    // Check that volunteer supports the student's cause
    if (!volunteer.causes.includes(student.cause)) {
      return NextResponse.json(
        { error: 'Volunteer does not support the student\'s cause' },
        { status: 400 }
      )
    }

    // Update student topics (case-insensitive search)
    const topics = (student.topicsNeedSupport as unknown as TopicWithAssignment[]) || []
    const topicIndex = topics.findIndex(
      (t) => t.keyword.toLowerCase() === subjectKeyword.toLowerCase()
    )

    if (topicIndex === -1) {
      return NextResponse.json({ error: 'Subject not found in student topics' }, { status: 404 })
    }

    // Use the original keyword from the student's topics for consistency
    const actualKeyword = topics[topicIndex].keyword

    // Check if already assigned to same volunteer
    if (topics[topicIndex].assignedTo === volunteerId) {
      return NextResponse.json({ error: 'Subject already assigned to this volunteer' }, { status: 400 })
    }

    const previousVolunteerId = topics[topicIndex].assignedTo

    // Update the topic
    topics[topicIndex] = {
      ...topics[topicIndex],
      status: 'assigned',
      assignedTo: volunteerId,
      volunteerName: volunteer.fullName,
    }

    // Update student record
    await prisma.student.update({
      where: { id: studentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { topicsNeedSupport: topics as any },
    })

    // Create assignment audit record
    await prisma.subjectAssignment.create({
      data: {
        studentId,
        subjectKeyword: actualKeyword,
        assignedToVolunteerId: volunteerId,
        assignedByAdminId: payload.userId,
        action: previousVolunteerId ? 'reassigned' : 'assigned',
        previousVolunteerId,
      },
    })

    // Check if there's an existing match, if not create one
    const existingMatch = await prisma.match.findUnique({
      where: { studentId_volunteerId: { studentId, volunteerId } },
    })

    if (existingMatch) {
      // Add subject to existing match if not already there (case-insensitive check)
      const currentSubjects = existingMatch.assignedSubjects || []
      const alreadyHasSubject = currentSubjects.some(
        (s) => s.toLowerCase() === actualKeyword.toLowerCase()
      )
      if (!alreadyHasSubject) {
        await prisma.match.update({
          where: { id: existingMatch.id },
          data: {
            assignedSubjects: [...currentSubjects, actualKeyword],
          },
        })
      }
    } else {
      // Create new match with pending_email status
      await prisma.match.create({
        data: {
          studentId,
          volunteerId,
          assignedSubjects: [actualKeyword],
          status: 'pending_email',
          autoSuggested: false,
          adminId: payload.userId,
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Subject "${actualKeyword}" assigned to ${volunteer.fullName}`,
    })
  } catch (error) {
    console.error('Error assigning subject:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Unassign a subject from a volunteer
export async function DELETE(
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

    const body = await request.json()
    const validation = unassignSubjectSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: validation.error.issues },
        { status: 400 }
      )
    }

    const { subjectKeyword } = validation.data

    const student = await prisma.student.findUnique({
      where: { id: studentId },
    })

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    const topics = (student.topicsNeedSupport as unknown as TopicWithAssignment[]) || []
    const topicIndex = topics.findIndex(
      (t) => t.keyword.toLowerCase() === subjectKeyword.toLowerCase()
    )

    if (topicIndex === -1) {
      return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
    }

    // Use the original keyword for consistency
    const actualKeyword = topics[topicIndex].keyword
    const previousVolunteerId = topics[topicIndex].assignedTo

    if (!previousVolunteerId) {
      return NextResponse.json({ error: 'Subject is not assigned' }, { status: 400 })
    }

    // Update the topic
    topics[topicIndex] = {
      ...topics[topicIndex],
      status: 'unassigned',
      assignedTo: null,
      volunteerName: undefined,
    }

    await prisma.student.update({
      where: { id: studentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { topicsNeedSupport: topics as any },
    })

    // Create audit record
    await prisma.subjectAssignment.create({
      data: {
        studentId,
        subjectKeyword: actualKeyword,
        assignedByAdminId: payload.userId,
        action: 'unassigned',
        previousVolunteerId,
      },
    })

    // Update the match to remove this subject (case-insensitive)
    const match = await prisma.match.findUnique({
      where: { studentId_volunteerId: { studentId, volunteerId: previousVolunteerId } },
    })

    if (match) {
      const updatedSubjects = match.assignedSubjects.filter(
        (s) => s.toLowerCase() !== actualKeyword.toLowerCase()
      )
      if (updatedSubjects.length === 0) {
        // Delete match if no subjects left
        await prisma.match.delete({ where: { id: match.id } })
      } else {
        await prisma.match.update({
          where: { id: match.id },
          data: { assignedSubjects: updatedSubjects },
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Subject "${actualKeyword}" unassigned`,
    })
  } catch (error) {
    console.error('Error unassigning subject:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
