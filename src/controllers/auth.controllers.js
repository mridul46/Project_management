import { User } from "../models/user.models.js";
import { ApiResponse } from "../utils/api-response.js";
import { ApiError } from "../utils/api-error.js";
import { asyncHandler } from "../utils/async-handler.js";
import { emailVerificationMailgenContent, forgotPasswordMailgenContent, sendEmail } from "../utils/mail.js";
import jwt from "jsonwebtoken"
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

const getCurrentUser=asyncHandler(async(req,res)=>{
    return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        req.user,
        "Current User fetched successfully"
      )
    )
})


const verifyEmail=asyncHandler(async(req,res)=>{
     const {verificationToken} =req.params
     if(!verificationToken){
      throw new ApiError(400,"Email verification token is missing")
     }

     let hashedToken=crypto
         .createHash("sha256")
         .update(verificationToken)
         .digest("hex")
    
     const user= await User.findOne({
      emailVerificationToken:hashedToken,
      emailVerificationExpiry:{$gt:Date.now()}
     })

    if(!user){
      throw new ApiError(400,"Token is invalid or expired")
    }  
    
    user.emailVerificationToken=undefined;
    user.emailVerificationExpiry=undefined;
    user.isEmailVerified=true;

    await user.save({validateBeforeSave:false})

    return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {
          isEmailVerified:true
        },
        "Email is verified",

      )
    )
})
const resendEmailVerification=asyncHandler(async(req,res)=>{
   const user= await User.findById(req.user._id)

   if(!user){
    throw new ApiError(404,"User does not exist")
   }

   if(user.isEmailVerified){
    throw new ApiError(409, "Email is already verified")
   }
     
  const {
    unHasedToken, 
    hasedToken,   
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
  return res
  .status(200)
  .json(
  new ApiResponse(
  200,
  {},
   "Mail has been sent to your email Id"
  )
  )

})

const refreshAccessToken=asyncHandler(async(req,res)=>{
   const incomingRefreshToken=req.cookies.refreshToken || req.body.refreshToken

   if(!incomingRefreshToken){
    throw new ApiError(401,"Unauthorized access")
   }

   try {
    const decodedToken=jwt.verify(incomingRefreshToken,process.env.REFRESH_TOKEN_SECRET)
    const user= await User.findById(decodedToken?._id)
    if(!user){
      throw new ApiError(401,"Invalid refresh token")
    }

    if(incomingRefreshToken!==user?.refreshToken){
      throw new ApiError(401," refresh token is expired")
    }

    const options={
      httpOnly:true,
      secure:true
    }
    const {accessToken,refreshToken:newRefreshToken}=await generateAccessAndRefreshTokens(user._id)
    user.refreshToken=newRefreshToken;
    await user.save();
    return res
          .status(200)
          .cookie("accessToken",accessToken,options)
          .cookie("refreshToken",newRefreshToken,options)
          .json(
            new ApiResponse(
              200,
              {accessToken,refreshAccessToken:newRefreshToken},
              "Access token refrshed"
            )
          )
   } catch (error) {
      throw new ApiError(401," invalid refresh token ")
   }
})

const forgotPasswordRequest=asyncHandler(async(req,res)=>{
  const {email}= req.body
  const user= User.findOne(email)

  if(!user){
    throw new ApiError(404,"User does not exists")
  }
    const {
    unHashedToken,
    hashedToken, 
    tokenExpiry,
  } = await user.generateTemporaryToken();

  user.forgotPasswordToken=hashedToken
  user.forgotPasswordExpiry=tokenExpiry

  await user.save({validateBeforeSave:false})

    await sendEmail({
    email: user?.email,
    subject: "Password reset request",
    mailgenContent: forgotPasswordMailgenContent(
      user.username,
      `${process.env.FORGOT_PASSWORD_REDIRECT_URL}/${unHashedToken}`,
    ),
  });

  return res
  .status(200)
  .json(
    new ApiResponse(
      200,
      {},
    "Password reset mail has been sent on your mail Id"
    )
  )
})
const resetForgotPassword=asyncHandler(async(req,res)=>{
  const {resetToken} = req.params
  const {newPassword} = req.body

  let hashedToken= crypto
      .createHash( "sha256")
      .update(resetToken)
      .digest("hex")

  const user=await User.findOne({
    forgotPasswordToken:hashedToken,
    forgotPasswordExpiry:{$gt:Date.now()}
  });
  if(!user){
    throw new ApiError(489, "token is invalid or expired")
  }
  user.forgotPasswordExpiry=undefined
  user.forgotPasswordToken=undefined

  user.password=newPassword
  await user.save({validateBeforeSave:false})

  return res
    .response(200)
    .json(
      new ApiResponse(200,{},"Password reset successfully")
    );
})

const changeCurrentPassword=asyncHandler(async(req,res)=>{
      const {oldPassword,newPassword}= req.body
      const user= await User.findById(req.user?._id)
      const isPasswordValid=await user.isPasswordCorrect(oldPassword)

      if(!isPasswordValid){
        throw new ApiError(400,"invalid old password")
      }

      user.password=newPassword
      await user.save({validateBeforeSave:false})

      return res
      .status(200)
      .json(
        new ApiResponse(
          200, {},"password changeed  successfully"
        )
      )
})

export { registerUser ,
  login,
  logoutUser,
  getCurrentUser,
  verifyEmail,
  resendEmailVerification,
  refreshAccessToken,
  forgotPasswordRequest,
  resetForgotPassword,
changeCurrentPassword
};
