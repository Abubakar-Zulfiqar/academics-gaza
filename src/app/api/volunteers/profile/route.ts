import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { volunteerProfileSchema } from '@/lib/validations'

export async function GET() {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.role !== 'volunteer' && session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const volunteer = await prisma.volunteer.findUnique({
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
            student: {
              select: {
                id: true,
                fullName: true,
                topicsNeedSupport: true,
              },
            },
          },
        },
      },
    })

    if (!volunteer) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Calculate current capacity dynamically from active matches
    const activeMatchCount = volunteer.matches.length

    return NextResponse.json({
      volunteer: {
        ...volunteer,
        currentCapacity: activeMatchCount, // Dynamic calculation
      },
    })
  } catch (error) {
    console.error('Get volunteer profile error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (session.role !== 'volunteer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if profile already exists
    const existingProfile = await prisma.volunteer.findUnique({
      where: { userId: session.userId },
    })

    if (existingProfile) {
      return NextResponse.json({ error: 'Profile already exists' }, { status: 400 })
    }

    const body = await request.json()
    const validatedData = volunteerProfileSchema.parse(body)

    // Auto-assign all active causes to the tutor
    const allCauses = await prisma.cause.findMany({
      where: { isActive: true },
      select: { name: true },
    })
    const allCauseNames = allCauses.map((c: { name: string }) => c.name)

    const volunteer = await prisma.volunteer.create({
      data: {
        userId: session.userId,
        fullName: validatedData.fullName,
        age: validatedData.age,
        phoneNumber: validatedData.phoneNumber,
        city: validatedData.city,
        country: validatedData.country,
        area: validatedData.area,
        universityAffiliation: validatedData.universityAffiliation,
        fieldsOfExpertise: validatedData.fieldsOfExpertise,
        subjectsQualified: validatedData.subjectsQualified,
        languagesSpoken: validatedData.languagesSpoken,
        preferredLanguage: validatedData.preferredLanguage,
        onlineTeachingExperience: validatedData.onlineTeachingExperience,
        diverseBackgroundExperience: validatedData.diverseBackgroundExperience,
        hoursPerWeekAvailable: validatedData.hoursPerWeekAvailable,
        maxCapacity: validatedData.maxCapacity,
        causes: allCauseNames,
        additionalSupportWilling: validatedData.additionalSupportWilling,
        bio: validatedData.bio,
      },
    })

    // Create match trigger for new volunteer
    await prisma.matchTrigger.create({
      data: {
        triggerType: 'new_volunteer',
        entityId: volunteer.id,
      },
    })

    return NextResponse.json({ volunteer, message: 'Profile created successfully' })
  } catch (error) {
    console.error('Create volunteer profile error:', error)
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

    if (session.role !== 'volunteer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const validatedData = volunteerProfileSchema.partial().parse(body)

    const volunteer = await prisma.volunteer.update({
      where: { userId: session.userId },
      data: validatedData,
    })

    // If capacity changed, create trigger
    if (validatedData.maxCapacity !== undefined) {
      await prisma.matchTrigger.create({
        data: {
          triggerType: 'capacity_change',
          entityId: volunteer.id,
        },
      })
    }

    return NextResponse.json({ volunteer, message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Update volunteer profile error:', error)
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid input data' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
