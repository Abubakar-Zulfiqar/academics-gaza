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

    const volunteers = await prisma.volunteer.findMany({
      include: {
        matches: {
          include: {
            student: {
              select: { id: true, fullName: true },
            },
          },
        },
      },
      orderBy: [
        { isActive: 'desc' }, // Active volunteers first
        { createdAt: 'desc' },
      ],
    })

    const formattedVolunteers = volunteers.map((volunteer: any) => {
      // Calculate current capacity dynamically from active matches
      const activeMatchCount = volunteer.matches.filter(
        (m: any) => ['accepted', 'active'].includes(m.status)
      ).length

      return {
        id: volunteer.id,
        fullName: volunteer.fullName,
        causes: volunteer.causes,
        fieldsOfExpertise: volunteer.fieldsOfExpertise,
        subjectsQualified: volunteer.subjectsQualified,
        languagesSpoken: volunteer.languagesSpoken,
        preferredLanguage: volunteer.preferredLanguage,
        hoursPerWeekAvailable: volunteer.hoursPerWeekAvailable,
        currentCapacity: activeMatchCount, // Dynamic calculation
        maxCapacity: volunteer.maxCapacity,
        capacitySetBy: volunteer.capacitySetBy,
        city: volunteer.city,
        country: volunteer.country,
        rating: volunteer.rating,
        totalHoursVolunteered: volunteer.totalHoursVolunteered,
        studentsHelped: volunteer.studentsHelped,
        isActive: volunteer.isActive,
        matches: volunteer.matches.map((match: any) => ({
          id: match.id,
          status: match.status,
          student: {
            id: match.student.id,
            fullName: match.student.fullName,
          },
          assignedSubjects: match.assignedSubjects,
        })),
      }
    })

    return NextResponse.json({ volunteers: formattedVolunteers })
  } catch (error) {
    console.error('Error fetching volunteers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new volunteer (Admin only)
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
      phoneNumber,
      city,
      country,
      area,
      universityAffiliation,
      causes,
      fieldsOfExpertise,
      subjectsQualified,
      languagesSpoken,
      preferredLanguage,
      onlineTeachingExperience,
      diverseBackgroundExperience,
      hoursPerWeekAvailable,
      maxCapacity,
      additionalSupportWilling,
      bio,
    } = body

    // Validate required fields
    if (!email || !password || !fullName) {
      return NextResponse.json(
        { error: 'Email, password, and full name are required' },
        { status: 400 }
      )
    }

    // Auto-assign all active causes to the tutor
    const allCauses = await prisma.cause.findMany({
      where: { isActive: true },
      select: { name: true },
    })
    const allCauseNames = allCauses.map((c: any) => c.name)

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

    // Create user and volunteer in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'volunteer',
        },
      })

      // Create volunteer profile
      const volunteer = await tx.volunteer.create({
        data: {
          userId: user.id,
          fullName,
          age: age ? parseInt(age) : null,
          phoneNumber,
          city,
          country,
          area,
          universityAffiliation,
          causes: allCauseNames,
          fieldsOfExpertise: fieldsOfExpertise || [],
          subjectsQualified: subjectsQualified || [],
          languagesSpoken: languagesSpoken || [],
          preferredLanguage,
          onlineTeachingExperience: onlineTeachingExperience || false,
          diverseBackgroundExperience: diverseBackgroundExperience || false,
          hoursPerWeekAvailable: hoursPerWeekAvailable ? parseInt(hoursPerWeekAvailable) : null,
          maxCapacity: maxCapacity ? parseInt(maxCapacity) : 5,
          currentCapacity: 0,
          additionalSupportWilling,
          bio,
        },
      })

      return { user, volunteer }
    })

    return NextResponse.json({
      success: true,
      message: 'Volunteer created successfully',
      volunteer: {
        id: result.volunteer.id,
        fullName: result.volunteer.fullName,
        email: email,
      },
    })
  } catch (error) {
    console.error('Error creating volunteer:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
