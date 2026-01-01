import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken, hashPassword } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function GET() {
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

    const students = await prisma.student.findMany({
      select: {
        id: true,
        fullName: true,
        cause: true,
        fieldsOfStudy: true,
        topicsNeedSupport: true,
        languagesSpoken: true,
        preferredLanguage: true,
        hoursPerWeekNeeded: true,
        currentCity: true,
        currentCountry: true,
        isActive: true,
        matches: {
          include: {
            volunteer: {
              select: { id: true, fullName: true },
            },
          },
        },
      },
      orderBy: [
        { isActive: 'desc' }, // Active students first
        { createdAt: 'desc' },
      ],
    })

    const formattedStudents = students.map((student: any) => ({
      id: student.id,
      fullName: student.fullName,
      cause: student.cause,
      fieldsOfStudy: student.fieldsOfStudy,
      topicsNeedSupport: student.topicsNeedSupport,
      languagesSpoken: student.languagesSpoken,
      preferredLanguage: student.preferredLanguage,
      hoursPerWeekNeeded: student.hoursPerWeekNeeded,
      currentCity: student.currentCity,
      currentCountry: student.currentCountry,
      isActive: student.isActive,
      matches: student.matches.map((match: any) => ({
        id: match.id,
        status: match.status,
        volunteer: {
          id: match.volunteer.id,
          fullName: match.volunteer.fullName,
        },
        assignedSubjects: match.assignedSubjects,
      })),
    }))

    return NextResponse.json({ students: formattedStudents })
  } catch (error) {
    console.error('Error fetching students:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new student (Admin only)
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
    const {
      email,
      password,
      fullName,
      age,
      gender,
      phoneNumber,
      alternativeContact,
      currentCity,
      currentCountry,
      area,
      originalLocation,
      cause,
      fieldsOfStudy,
      topicsNeedSupport,
      originalUniversity,
      currentUniversity,
      creditsRemaining,
      hasTranscripts,
      preferredLanguage,
      languagesSpoken,
      hoursPerWeekNeeded,
      deviceAccessLevel,
      internetAccessLevel,
      materialsAccessLevel,
      specialNeeds,
      educationalBackground,
      careerGoals,
    } = body

    // Validate required fields
    if (!email || !password || !fullName || !cause) {
      return NextResponse.json(
        { error: 'Email, password, full name, and cause are required' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 400 }
      )
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Format topics
    const formattedTopics = (topicsNeedSupport || []).map((topic: string) => ({
      keyword: topic,
      status: 'unassigned',
      assignedTo: null,
    }))

    // Create user and student in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'student',
        },
      })

      // Create student profile
      const student = await tx.student.create({
        data: {
          userId: user.id,
          fullName,
          age: age ? parseInt(age) : null,
          gender,
          phoneNumber,
          alternativeContact,
          currentCity,
          currentCountry,
          area,
          originalLocation,
          cause,
          fieldsOfStudy: fieldsOfStudy || [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          topicsNeedSupport: formattedTopics as any,
          originalUniversity,
          currentUniversity,
          creditsRemaining: creditsRemaining ? parseInt(creditsRemaining) : null,
          hasTranscripts: hasTranscripts || false,
          preferredLanguage,
          languagesSpoken: languagesSpoken || [],
          hoursPerWeekNeeded: hoursPerWeekNeeded ? parseInt(hoursPerWeekNeeded) : null,
          deviceAccessLevel: deviceAccessLevel ? parseInt(deviceAccessLevel) : null,
          internetAccessLevel: internetAccessLevel ? parseInt(internetAccessLevel) : null,
          materialsAccessLevel: materialsAccessLevel ? parseInt(materialsAccessLevel) : null,
          specialNeeds,
          educationalBackground,
          careerGoals,
        },
      })

      return { user, student }
    })

    return NextResponse.json({
      success: true,
      message: 'Student created successfully',
      student: {
        id: result.student.id,
        fullName: result.student.fullName,
        email: email,
      },
    })
  } catch (error) {
    console.error('Error creating student:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
