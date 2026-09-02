import UserService from '../services/user.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/ApiResponse.js';

/**
 * UserController — "me" (self-service) endpoints + admin user administration.
 */
class UserController {
  /** GET /users/me — full profile. */
  getMe = asyncHandler(async (req, res) => {
    const user = await UserService.getProfile(req.auth.userId);
    res.status(200).json(success(user, { message: 'Profile fetched' }));
  });

  /** PATCH /users/me — update profile/preferences/marketing. */
  updateMe = asyncHandler(async (req, res) => {
    const user = await UserService.updateProfile(req.auth.userId, req.body);
    res.status(200).json(success(user, { message: 'Profile updated' }));
  });

  /** PUT /users/me/location — set the user's store location (slots/catalogue driver). */
  updateLocation = asyncHandler(async (req, res) => {
    const user = await UserService.updateLocation(req.auth.userId, req.body.location);
    res.status(200).json(success(user, { message: 'Location updated' }));
  });

  /** DELETE /users/me — self soft-delete (account deletion request). */
  deleteMe = asyncHandler(async (req, res) => {
    const { default: User } = await import('../models/user.model.js');
    await User.softDeleteById(req.auth.userId, { by: req.auth.userId });
    res.status(200).json(success(null, { message: 'Account deletion requested' }));
  });

  // ---------------- admin ----------------

  /** GET /users — admin list (paginated, filterable). */
  list = asyncHandler(async (req, res) => {
    const result = await UserService.listUsers({ tenantId: req.tenantId, query: req.query });
    res.status(200).json(success(result.items, { message: 'Users fetched', meta: result.meta }));
  });

  /** GET /users/:id — admin single fetch. */
  getById = asyncHandler(async (req, res) => {
    const user = await UserService.getUserById({ tenantId: req.tenantId, userId: req.params.id });
    res.status(200).json(success(user, { message: 'User fetched' }));
  });

  /** PATCH /users/:id/role — assign role (vendor/admin). */
  setRole = asyncHandler(async (req, res) => {
    const user = await UserService.setRole({
      tenantId: req.tenantId,
      userId: req.params.id,
      role: req.body.role,
    });
    res.status(200).json(success(user, { message: 'Role updated' }));
  });

  /** PATCH /users/:id/status — block / activate. */
  setStatus = asyncHandler(async (req, res) => {
    const user = await UserService.setStatus({
      tenantId: req.tenantId,
      userId: req.params.id,
      status: req.body.status,
    });
    res.status(200).json(success(user, { message: 'Status updated' }));
  });
}

export default new UserController();
