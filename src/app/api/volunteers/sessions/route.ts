import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'
import { z } from 'zod'

const sessionSchema = z.object({
  matchId: z.string().uuid(),
  scheduledAt: z.string(),
  durationMinutes: z.number().min(15).max(180),
  platform: z.string().optional(),
  subjectsCovered: z.array(z.string()),
  volunteerNotes: z.string().optional(),
})

export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'volunteer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const volunteer = await prisma.volunteer.findUnique({
      where: { userId: payload.userId },
    })

    if (!volunteer) {
      return NextResponse.json({ error: 'Volunteer profile not found' }, { status: 404 })
    }

    const sessions = await prisma.session.findMany({
      where: {
        match: {
          volunteerId: volunteer.id,
        },
      },
      include: {
        match: {
          include: {
            student: {
              select: { fullName: true },
            },
          },
        },
      },
      orderBy: { scheduledAt: 'desc' },
    })

    return NextResponse.json({
      sessions: sessions.map((session: any) => ({
        id: session.id,
        status: session.status,
        date: session.scheduledAt?.toISOString() || null,
        durationMinutes: session.durationMinutes,
        subjectsCovered: session.subjectsCovered,
        volunteerNotes: session.volunteerNotes,
        match: {
          id: session.matchId,
          student: session.match.student,
          assignedSubjects: session.match.assignedSubjects,
        },
      })),
    })
  } catch (error) {
    console.error('Error fetching sessions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'volunteer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const volunteer = await prisma.volunteer.findUnique({
      where: { userId: payload.userId },
    })

    if (!volunteer) {
      return NextResponse.json({ error: 'Volunteer profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const validation = sessionSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid session data', details: validation.error.issues },
        { status: 400 }
      )
    }

    const { matchId, scheduledAt, durationMinutes, platform, subjectsCovered, volunteerNotes } = validation.data

    // Verify the match belongs to this volunteer
    const match = await prisma.match.findUnique({
      where: { id: matchId },
    })

    if (!match || match.volunteerId !== volunteer.id) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    if (match.status !== 'active') {
      return NextResponse.json(
        { error: 'Can only create sessions for active matches' },
        { status: 400 }
      )
    }

    const session = await prisma.session.create({
      data: {
        matchId,
        scheduledAt: new Date(scheduledAt),
        durationMinutes,
        platform: platform || null,
        subjectsCovered,
        volunteerNotes: volunteerNotes || null,
        status: new Date(scheduledAt) > new Date() ? 'scheduled' : 'completed',
      },
    })

    // If session is completed, update volunteer hours
    if (session.status === 'completed') {
      await prisma.volunteer.update({
        where: { id: volunteer.id },
        data: {
          totalHoursVolunteered: {
            increment: Math.round(durationMinutes / 60 * 10) / 10,
          },
        },
      })
    }

    return NextResponse.json({ session }, { status: 201 })
  } catch (error) {
    console.error('Error creating session:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
