import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('accessToken')?.value

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(token)
    if (!payload || payload.role !== 'student') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const student = await prisma.student.findUnique({
      where: { userId: payload.userId },
    })

    if (!student) {
      return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })
    }

    const sessions = await prisma.session.findMany({
      where: {
        match: {
          studentId: student.id,
        },
      },
      include: {
        match: {
          include: {
            volunteer: {
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
        studentNotes: session.studentNotes,
        match: {
          id: session.matchId,
          volunteer: session.match.volunteer,
          assignedSubjects: session.match.assignedSubjects,
        },
      })),
    })
  } catch (error) {
    console.error('Error fetching student sessions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
