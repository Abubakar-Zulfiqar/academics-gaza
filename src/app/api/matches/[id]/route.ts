import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'

interface Topic {
  keyword: string
  status: string
  assignedTo?: string
}

export async function DELETE(
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
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get match with student info
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        student: {
          select: {
            id: true,
            topicsNeedSupport: true,
          },
        },
      },
    })

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    // Check if match was active (affects capacity)
    const wasActive = ['accepted', 'active'].includes(match.status)

    // Delete match, reset student topics, and update volunteer capacity in a transaction
    await prisma.$transaction(async (tx: any) => {
      // Reset student's topic status for assigned subjects
      if (match.assignedSubjects.length > 0) {
        const topics = match.student.topicsNeedSupport as unknown as Topic[]
        const updatedTopics = topics.map((topic: any) => {
          // If this topic was assigned in this match, reset it
          if (
            match.assignedSubjects.some(
              (s: string) => s.toLowerCase() === topic.keyword.toLowerCase()
            )
          ) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { assignedTo, ...rest } = topic
            return { ...rest, status: 'unassigned' }
          }
          return topic
        })

        await tx.student.update({
          where: { id: match.studentId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { topicsNeedSupport: updatedTopics as any },
        })
      }

      // Decrement volunteer capacity if match was active
      if (wasActive) {
        await tx.volunteer.update({
          where: { id: match.volunteerId },
          data: {
            currentCapacity: {
              decrement: 1,
            },
          },
        })
      }

      // Delete the match
      await tx.match.delete({
        where: { id: matchId },
      })
    })

    return NextResponse.json({
      success: true,
      message: 'Match deleted and topics reset to unassigned',
    })
  } catch (error) {
    console.error('Error deleting match:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(
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
        student: {
          select: {
            id: true,
            fullName: true,
            cause: true,
            fieldsOfStudy: true,
            topicsNeedSupport: true,
          },
        },
        volunteer: {
          select: {
            id: true,
            fullName: true,
            subjectsQualified: true,
          },
        },
      },
    })

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    // Check access permissions
    if (payload.role === 'volunteer') {
      const volunteer = await prisma.volunteer.findUnique({
        where: { userId: payload.userId },
      })
      if (!volunteer || volunteer.id !== match.volunteerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (payload.role === 'student') {
      const student = await prisma.student.findUnique({
        where: { userId: payload.userId },
      })
      if (!student || student.id !== match.studentId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    return NextResponse.json({ match })
  } catch (error) {
    console.error('Error fetching match:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
