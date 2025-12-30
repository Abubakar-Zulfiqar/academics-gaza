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

    const matches = await prisma.match.findMany({
      where: {
        studentId: student.id,
      },
      include: {
        volunteer: {
          select: {
            id: true,
            fullName: true,
            fieldsOfExpertise: true,
            subjectsQualified: true,
            languagesSpoken: true,
            preferredLanguage: true,
            bio: true,
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
        volunteer: match.volunteer,
      })),
    })
  } catch (error) {
    console.error('Error fetching student teachers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
