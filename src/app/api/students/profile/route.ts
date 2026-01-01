import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { studentProfileSchema } from '@/lib/validations'

export async function GET() {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.role !== 'student' && session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.userId },
      include: {
        user: {
          select: {
            email: true,
            isVerified: true,
          },
        },
        matches: {
          where: {
            status: { in: ['accepted', 'active'] },
          },
          include: {
            volunteer: {
              select: {
                id: true,
                fullName: true,
                subjectsQualified: true,
              },
            },
          },
        },
      },
    })

    if (!student) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    return NextResponse.json({ student })
  } catch (error) {
    console.error('Get student profile error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.role !== 'student') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if profile already exists
    const existingProfile = await prisma.student.findUnique({
      where: { userId: session.userId },
    })

    if (existingProfile) {
      return NextResponse.json({ error: 'Profile already exists' }, { status: 400 })
    }

    const body = await request.json()
    const validatedData = studentProfileSchema.parse(body)

    const student = await prisma.student.create({
      data: {
        userId: session.userId,
        fullName: validatedData.fullName,
        age: validatedData.age,
        gender: validatedData.gender,
        phoneNumber: validatedData.phoneNumber,
        alternativeContact: validatedData.alternativeContact,
        currentCity: validatedData.currentCity,
        currentCountry: validatedData.currentCountry,
        area: validatedData.area,
        originalLocation: validatedData.originalLocation,
        cause: validatedData.cause,
        fieldsOfStudy: validatedData.fieldsOfStudy,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        topicsNeedSupport: validatedData.topicsNeedSupport as any,
        originalUniversity: validatedData.originalUniversity,
        currentUniversity: validatedData.currentUniversity,
        creditsRemaining: validatedData.creditsRemaining,
        hasTranscripts: validatedData.hasTranscripts,
        preferredLanguage: validatedData.preferredLanguage,
        languagesSpoken: validatedData.languagesSpoken,
        hoursPerWeekNeeded: validatedData.hoursPerWeekNeeded,
        deviceAccessLevel: validatedData.deviceAccessLevel,
        internetAccessLevel: validatedData.internetAccessLevel,
        materialsAccessLevel: validatedData.materialsAccessLevel,
        specialNeeds: validatedData.specialNeeds,
        educationalBackground: validatedData.educationalBackground,
        careerGoals: validatedData.careerGoals,
      },
    })

    // Create match trigger for new student
    await prisma.matchTrigger.create({
      data: {
        triggerType: 'new_student',
        entityId: student.id,
      },
    })

    return NextResponse.json({ student, message: 'Profile created successfully' })
  } catch (error) {
    console.error('Create student profile error:', error)
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid input data' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.role !== 'student') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const validatedData = studentProfileSchema.partial().parse(body)

    const student = await prisma.student.update({
      where: { userId: session.userId },
      data: validatedData,
    })

    return NextResponse.json({ student, message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Update student profile error:', error)
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid input data' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
