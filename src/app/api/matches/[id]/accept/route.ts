import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'

interface Topic {
  keyword: string
  status: string
  assignedTo: string | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        student: true,
        volunteer: true,
      },
    })

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    // Only the assigned volunteer can accept
    if (payload.role === 'volunteer') {
      const volunteer = await prisma.volunteer.findUnique({
        where: { userId: payload.userId },
      })

      if (!volunteer || volunteer.id !== match.volunteerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!['pending', 'email_sent'].includes(match.status)) {
      return NextResponse.json(
        { error: 'Match is not in a state that can be accepted' },
        { status: 400 }
      )
    }

    // Update match status to active
    const updatedMatch = await prisma.match.update({
      where: { id: matchId },
      data: { status: 'active' },
    })

    // Update student's topics to assigned
    const topics = match.student.topicsNeedSupport as unknown as Topic[]
    const updatedTopics = topics.map((topic: Topic) => {
      if (match.assignedSubjects.includes(topic.keyword)) {
        return {
          ...topic,
          status: 'assigned',
          assignedTo: match.volunteerId,
        }
      }
      return topic
    })

    await prisma.student.update({
      where: { id: match.studentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { topicsNeedSupport: updatedTopics as any },
    })

    // Update volunteer's current capacity
    await prisma.volunteer.update({
      where: { id: match.volunteerId },
      data: { currentCapacity: { increment: 1 } },
    })

    // Send notification email to student
    const template = await prisma.emailTemplate.findFirst({
      where: { name: 'match_accepted' },
    })

    if (template) {
      const emailBody = template.body
        .replace(/\{\{volunteer_name\}\}/g, match.volunteer.fullName)
        .replace(/\{\{student_name\}\}/g, match.student.fullName)
        .replace(/\{\{subjects\}\}/g, match.assignedSubjects.join(', '))

      console.log('Sending acceptance email to student')
      console.log('Body:', emailBody)
    }

    return NextResponse.json({
      match: {
        id: updatedMatch.id,
        status: updatedMatch.status,
      },
    })
  } catch (error) {
    console.error('Error accepting match:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
