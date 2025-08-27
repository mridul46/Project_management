import { User } from "../models/user.models.js";
import { ApiResponse } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { asyncHandler } from "../utils/async-handler.js";
import { emailVerificationMailgenContent, sendEmail } from "../utils/mail.js";

// ✅ Fixed: added `await` in findById and changed save() properly
const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId); // <-- you fixed this 👍
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false }); // <-- correct usage now
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "something went wrong while generating access token" // <-- typo fixed: 'wennt' → 'went'
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  const { email, username, password, roles } = req.body;

  const exitedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (exitedUser) {
    throw new ApiError(409, "User with email or username already exists", []);
  }

  // ✅ Suggestion: roles is destructured but not used in User.create()
  const user = await User.create({
    email,
    password,
    username,
    isEmailVerified: false,
    // roles,  <-- Uncomment this if roles should be stored
  });

  // ✅ Fixed: spelling mistakes in variables
  const {
    unHasedToken, // <-- typo: should be "unHashedToken" for clarity
    hasedToken,   // <-- typo: should be "hashedToken"
    tokenExpiry,
  } = await user.generateTemporaryToken();

  user.emailVerificationToken = hasedToken;
  user.emailVerificationExpiry = tokenExpiry;
  await user.save({ validateBeforeSave: false });

  await sendEmail({
    email: user?.email,
    subject: "Please verify your email",
    mailgenContent: emailVerificationMailgenContent(
      user.username,
      `${req.protocol}://${req.get(
        "host"
      )}/api/v1/users/verify-email/${unHasedToken}`
    ),
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken -emailVerificationToken -emailVerificationExpiry"
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering a user");
  }

  return res.status(201).json(
    // ❌ This is wrong:
    // .json(200, {user: createdUser}, "message")
    // Express .json() accepts only one object argument.

    new ApiResponse(
      201,
      { user: createdUser },
      "User registered successfully and verification email has been sent on your email"
    )
  );
});

const login=asyncHandler(async(req,res)=>{
  const {email,username,password}=req.body;

  if(!email) {
    throw new ApiError(400,"email is required")
  }
  const user=await User.findOne({email})
  if(!user){
    throw new ApiError(400,"User doesnot exists" ) 
  }

  const isPassWordValid= await user.isPasswordCorrect(password)

  if(!isPassWordValid){
    throw new ApiError(400,"invalid credentials")
  }
  

  const {accessToken,refreshToken}= await generateAccessAndRefreshTokens(user._id)
  
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken -emailVerificationToken -emailVerificationExpiry"
  );
  
  const options={
    httpOnly:true,
    secure:true,
  }
  
  return res
  .status(200)
  .cookie("accessToken",accessToken,options)
  .cookie("refreshToken",refreshToken,options)
  .json(
    new ApiResponse(
      200,{
        user: loggedInUser,
        accessToken,
        refreshToken
      },
      "User logged in successfully."
    )
  )


});
const logoutUser= asyncHandler(async(req,res)=>{
     await User.findByIdAndUpdate(
        req.user._id,
        {
          $set:{
            refreshToken:""

          }
        },
        {
          new:true
        },
     );
     const options={
      httpOnly:true,
      secure:true
     }
     return res
     .status(200)
     .clearCookie("accessToken",options)
     .clearCookie("refreshToken",options)
     .json(
      new ApiResponse(200,{},"User logged out")
     )
})

export { registerUser ,
  login,
  logoutUser,
};
