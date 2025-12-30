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
    if (!payload || payload.role !== 'volunteer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const volunteer = await prisma.volunteer.findUnique({
      where: { userId: payload.userId },
    })

    if (!volunteer) {
      return NextResponse.json({ error: 'Volunteer profile not found' }, { status: 404 })
    }

    const matches = await prisma.match.findMany({
      where: {
        volunteerId: volunteer.id,
      },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            cause: true,
            fieldsOfStudy: true,
            topicsNeedSupport: true,
            preferredLanguage: true,
            hoursPerWeekNeeded: true,
            deviceAccessLevel: true,
            internetAccessLevel: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      matches: matches.map((match: any) => ({
        id: match.id,
        status: match.status,
        assignedSubjects: match.assignedSubjects,
        student: match.student,
      })),
    })
  } catch (error) {
    console.error('Error fetching volunteer students:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
